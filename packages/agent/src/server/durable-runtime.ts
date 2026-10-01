import { checkWorkspaceReadiness } from "@atelier/workspace";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { LiveDoc, type AgentChange, type Conversation, type ConversationId, type HarnessOptions } from "@earendil-works/pi-durable";
import { createDurableHarnessOptions, prepareDurableConversation } from "./durable-assembly.ts";
import { markGatedDurableWork, WorkspaceAdmission } from "./durable-lifecycle.ts";
import { DurableConversationPresentation } from "./durable-presentation.ts";
import { durableImageEndpoint } from "./durable-images.ts";
import { submitDurableInput, type DurableInput } from "./durable-input.ts";
import { openDurableWorkspace, WorkspaceConversations, type DurableConversationRecord } from "./durable-workspace.ts";
import { expandWorkspaceSkillCommand } from "./skills.ts";
import { workspaceDurableJournalDirectory } from "./durable-storage.ts";
import type { WorkspaceAgentToolOptions } from "./tools.ts";

const context = BACKGROUND_CONTEXT;
type ConversationIdentity = Omit<DurableConversationRecord, "durableId">;
type SettingsChange = Pick<AgentChange, "model" | "thinkingLevel">;

const dependencies = {
  harness: createDurableHarnessOptions,
  prepare: prepareDurableConversation,
  expand: expandWorkspaceSkillCommand,
  ready: checkWorkspaceReadiness,
};

/**
 * Native execution owner, not an AgentSession adapter. One instance per workspace.
 * Reads/attachment are passive; execution checks workspace readiness first.
 * Close/delete gates are durable; production must persist them before removing
 * tabs or disposing execution workspaces.
 */
export async function openDurableAgentRuntime(
  directory: string,
  workspaceId: string,
  options: WorkspaceAgentToolOptions = {},
  load: typeof dependencies = dependencies,
) {
  const harnessOptions: HarnessOptions = await load.harness(workspaceId, options);
  const workspace = await openDurableWorkspace(directory, workspaceId, harnessOptions);
  const { harness } = workspace;
  const agents = new Map<string, Promise<ReturnType<typeof controller>>>();
  const commandDrains = new Set<() => Promise<void>>();
  let suspended = false;
  const gates = await harness.snapshot(WorkspaceAdmission, context);
  let deleted = gates?.deleted ?? false;
  const closed = new Set(gates?.closed ?? []);
  let deleting: Promise<void> | undefined;
  let readiness: Promise<void> | undefined;

  // Share concurrent probes, not a permanent ready flag: a workspace can have
  // stopped since the previous command. A failed probe rejects before admission
  // and a later command can retry after the host repairs the workspace.
  async function checkReady() {
    assertOpen();
    readiness ??= load.ready(workspaceId).finally(() => { readiness = undefined; });
    await readiness;
    assertOpen();
  }

  async function readyForExecution() {
    await checkReady();
    // A close/delete may have fenced another root while readiness was pending.
    // Mark its work before any command enables this workspace-wide scheduler.
    await persistGates();
    assertOpen();
  }

  async function settleTasks(conversationId?: ConversationId) {
    const inspection = await harness.inspect(context);
    const tasks = inspection.tasks.filter(({ record }) => conversationId === undefined || record.conversationId === conversationId);
    if (!tasks.length) return;
    await readyForExecution();
    await Promise.all(tasks.map(({ record }) => harness.waitForTask(record.id, context)));
  }

  async function persistGates() {
    await harness.commit(async (tx) => {
      const admission = await tx.doc(WorkspaceAdmission);
      admission.deleted = deleted;
      admission.closed = [...closed];
    }, context);
    await markGatedDurableWork(harness);
  }

  function assertOpen() {
    if (suspended) throw new Error("Durable agent runtime is suspended");
  }

  function controller(conversation: Conversation, identity: ConversationIdentity) {
    // Only host commands queue here, never generation/tool execution. Different
    // roots prepare independently, while model changes cannot race image sizing
    // and skill expansion for this root's next admission.
    let tail: Promise<void> = Promise.resolve();
    let closing: Promise<void> | undefined;
    function assertAdmission() {
      assertOpen();
      if (deleted) throw new Error("Durable workspace is deleted");
      if (closed.has(conversation.id)) throw new Error("Durable conversation is closed");
    }
    function command<T>(run: () => Promise<T>): Promise<T> {
      const result = tail.then(() => { assertAdmission(); return run(); });
      // The caller receives the rejection; a rejected command must not poison
      // the command line and prevent a later correction or Stop.
      tail = result.then(() => {}, () => {});
      return result;
    }

    commandDrains.add(() => tail);
    return {
      id: conversation.id,
      /** Fence immediately, persist before cancellation, retain passive history. */
      close() {
        assertOpen();
        closed.add(conversation.id);
        return closing ??= (async () => {
          await tail;
          await persistGates();
          await settleTasks(conversation.id);
        })().catch((error) => {
          closing = undefined;
          throw error;
        });
      },
      /** Canonical committed state, including partials and queued input. No scheduling. */
      watch: conversation.watch.bind(conversation),
      /** Host-owned mount; disposal detaches observation, not execution. */
      presentation: (onCommit?: Parameters<typeof DurableConversationPresentation.attach>[3]) => {
        assertOpen();
        return DurableConversationPresentation.attach(conversation, { workspaceId, conversationId: identity.conversationId }, context, onCommit);
      },
      history: conversation.entries.bind(conversation),
      context: conversation.context.bind(conversation),
      agent: conversation.agent.bind(conversation),
      image(entryId: string, contentIndex: number) {
        return durableImageEndpoint(conversation, entryId, contentIndex, context);
      },
      /** Commit searchable metadata without creating a second history file. */
      setTitle(title: string) {
        return command(() => harness.commit(async (tx) => {
          const catalog = await tx.doc(WorkspaceConversations);
          const record = catalog.conversations.find((item) => item.durableId === conversation.id)!;
          record.title = title;
          return { ...record };
        }, context));
      },
      knownRequest(requestId: string) {
        return command(async () => Boolean(await harness.commit((tx) => tx.submissionByRequest(conversation.id, requestId), context)));
      },
      submit(input: DurableInput) {
        return command(async () => {
          if (!input.requestId.trim()) throw new Error("A request ID is required for durable input");
          const existing = await harness.commit((tx) => tx.submissionByRequest(conversation.id, input.requestId), context);
          // The original admission wins even if the skill or model has gone
          // away, or a retry arrives with different text/attachments/settings.
          if (existing) return (await harness.submission(existing.id, context))!;
          await readyForExecution();
          assertAdmission();
          return submitDurableInput(conversation, workspaceId, harnessOptions.models, input, context, async (id, text) => {
            const expanded = await load.expand(id, text);
            assertAdmission();
            return expanded;
          }, assertAdmission);
        });
      },
      configure(change: SettingsChange) {
        return command(async () => {
          const current = await conversation.agent(context);
          const ref = change.model === undefined ? current.model : change.model;
          const model = ref ? harnessOptions.models.getModel(ref.provider, ref.modelId) : undefined;
          if (ref && !model) throw new Error(`Model not found: ${ref.provider}/${ref.modelId}`);
          if (change.thinkingLevel && model && !getSupportedThinkingLevels(model).includes(change.thinkingLevel)) {
            throw new Error(`Thinking level ${change.thinkingLevel} is not supported by ${model.id}`);
          }
          await conversation.configure(change, context);
        });
      },
      /** Explicit Stop withdraws queued input and cancels owned work. */
      stop() {
        return command(async () => {
          await readyForExecution();
          assertAdmission();
          await conversation.abort(context);
        });
      },
      compact(instructions?: string) {
        return command(async () => {
          await readyForExecution();
          assertAdmission();
          return conversation.compact(instructions, context);
        });
      },
      /** Reset context, retaining searchable history and the current settings. */
      reset() {
        return command(async () => {
          if ((await harness.snapshot(LiveDoc, conversation.id, context))?.run) {
            throw new Error("Stop the agent before starting a new session.");
          }
          await readyForExecution();
          assertAdmission();
          await conversation.reset(undefined, context);
        });
      },
    };
  }

  return {
    /** Discover retained histories without preparing prompts or starting work. */
    async catalog() {
      assertOpen();
      return (await harness.snapshot(WorkspaceConversations, context))!.conversations;
    },
    /** Reuse one host command line per Atelier UUID; reopening never rebuilds its prompt. */
    conversation(record: ConversationIdentity, initial: SettingsChange = {}) {
      assertOpen();
      let pending = agents.get(record.conversationId);
      if (!pending) {
        pending = (async () => {
          const catalog = await harness.snapshot(WorkspaceConversations, context);
          const existing = catalog?.conversations.find((item) => item.conversationId === record.conversationId);
          if (!existing && deleted) throw new Error("Durable workspace is deleted");
          if (!existing) {
            await checkReady();
            if (deleted) throw new Error("Durable workspace is deleted");
          }
          const prepared = existing ? {} : await load.prepare(workspaceId, record.conversationId, options, initial);
          assertOpen();
          if (!existing && deleted) throw new Error("Durable workspace is deleted");
          return controller(await workspace.conversation(record, prepared), record);
        })().catch((error) => {
          agents.delete(record.conversationId);
          throw error;
        });
        agents.set(record.conversationId, pending);
      }
      return pending;
    },
    /** Permanent admission fence; journal remains available for history and recovery. */
    delete() {
      assertOpen();
      deleted = true;
      return deleting ??= (async () => {
        // New attachment/admission is fenced before waiting for in-flight preparation.
        // Failed attachment still rejects to its caller, but cannot prevent deletion.
        await Promise.allSettled([...agents.values()]);
        await Promise.all([...commandDrains].map((drain) => drain()));
        await persistGates();
        await settleTasks();
      })().catch((error) => {
        deleting = undefined;
        throw error;
      });
    },
    /** Host restart resumes durable tasks, never submits a synthetic user prompt. */
    async resume() {
      await readyForExecution();
      harness.resume();
    },
    /** Host shutdown/unload: stop observation and scheduling, not the task's effects. */
    suspend() {
      suspended = true;
      return workspace.close();
    },
  };
}

/** Production opening path: retained, project-scoped storage on the existing read-only share. */
export async function openRetainedDurableAgentRuntime(
  workspaceId: string,
  options: WorkspaceAgentToolOptions = {},
  load: typeof dependencies = dependencies,
) {
  return openDurableAgentRuntime(await workspaceDurableJournalDirectory(workspaceId), workspaceId, options, load);
}

export type DurableAgentRuntime = Awaited<ReturnType<typeof openDurableAgentRuntime>>;
