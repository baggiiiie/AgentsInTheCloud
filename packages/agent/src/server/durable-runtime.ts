import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { LiveDoc, type AgentChange, type Conversation, type HarnessOptions } from "@earendil-works/pi-durable";
import { createDurableHarnessOptions, prepareDurableConversation } from "./durable-assembly.ts";
import { markGatedDurableWork, WorkspaceAdmission } from "./durable-lifecycle.ts";
import { durableImageEndpoint } from "./durable-images.ts";
import { submitDurableInput, type DurableInput } from "./durable-input.ts";
import { openDurableWorkspace, WorkspaceConversations, type DurableConversationRecord } from "./durable-workspace.ts";
import { expandWorkspaceSkillCommand } from "./skills.ts";
import type { WorkspaceAgentToolOptions } from "./tools.ts";

const context = BACKGROUND_CONTEXT;
type ConversationIdentity = Omit<DurableConversationRecord, "durableId">;
type SettingsChange = Pick<AgentChange, "model" | "thinkingLevel">;

const dependencies = {
  harness: createDurableHarnessOptions,
  prepare: prepareDurableConversation,
  expand: expandWorkspaceSkillCommand,
};

/**
 * Native execution owner, not an AgentSession adapter. One instance per workspace.
 * Reads/attachment are passive; resume requires the host to make the workspace ready.
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

  function controller(conversation: Conversation) {
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
          await conversation.abort(context, { background: true });
        })();
      },
      /** Canonical committed state, including partials and queued input. No scheduling. */
      watch: conversation.watch.bind(conversation),
      history: conversation.entries.bind(conversation),
      context: conversation.context.bind(conversation),
      agent: conversation.agent.bind(conversation),
      image(entryId: string, contentIndex: number) {
        return durableImageEndpoint(conversation, entryId, contentIndex, context);
      },
      submit(input: DurableInput) {
        return command(async () => {
          if (!input.requestId.trim()) throw new Error("A request ID is required for durable input");
          const existing = await harness.commit((tx) => tx.submissionByRequest(conversation.id, input.requestId), context);
          // The original admission wins even if the skill or model has gone
          // away, or a retry arrives with different text/attachments/settings.
          if (existing) return (await harness.submission(existing.id, context))!;
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
        return command(() => conversation.abort(context));
      },
      compact(instructions?: string) {
        return command(() => conversation.compact(instructions, context));
      },
      /** Reset context, retaining searchable history and the current settings. */
      reset() {
        return command(async () => {
          if ((await harness.snapshot(LiveDoc, conversation.id, context))?.run) {
            throw new Error("Stop the agent before starting a new session.");
          }
          await conversation.reset(undefined, context);
        });
      },
    };
  }

  return {
    /** Reuse one host command line per Atelier UUID; reopening never rebuilds its prompt. */
    conversation(record: ConversationIdentity, initial: SettingsChange = {}) {
      assertOpen();
      let pending = agents.get(record.conversationId);
      if (!pending) {
        pending = (async () => {
          const catalog = await harness.snapshot(WorkspaceConversations, context);
          const existing = catalog?.conversations.find((item) => item.conversationId === record.conversationId);
          if (!existing && deleted) throw new Error("Durable workspace is deleted");
          const prepared = existing ? {} : await load.prepare(workspaceId, record.conversationId, options, initial);
          assertOpen();
          if (!existing && deleted) throw new Error("Durable workspace is deleted");
          return controller(await workspace.conversation(record, prepared));
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
        const inspection = await harness.inspect(context);
        await Promise.all(inspection.tasks.map(({ record }) => harness.waitForTask(record.id, context)));
      })();
    },
    /** Host restart resumes durable tasks, never submits a synthetic user prompt. */
    resume() {
      assertOpen();
      harness.resume();
    },
    /** Host shutdown/unload: stop observation and scheduling, not the task's effects. */
    suspend() {
      suspended = true;
      return workspace.close();
    },
  };
}

export type DurableAgentRuntime = Awaited<ReturnType<typeof openDurableAgentRuntime>>;
