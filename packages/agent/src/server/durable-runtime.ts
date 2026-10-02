import { AtelierCoreError } from "@atelier/core";
import { checkWorkspaceReadiness } from "@atelier/workspace";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { LiveDoc, InboxDoc, AgentDoc, UsageDoc, defineDoc, type Cursor, type EntryId, type EntryRecord, type EntryDraft, type AgentChange, type Conversation, type ConversationId, type ConversationView, type HarnessOptions } from "@earendil-works/pi-durable";
import { createDurableHarnessOptions, prepareDurableConversation } from "./durable-assembly.ts";
import { commitDurableStop, markGatedDurableWork, settleStoppedDurableWork, WorkspaceAdmission } from "./durable-lifecycle.ts";
import { DurableConversationPresentation } from "./durable-presentation.ts";
import { durableImageEndpoint } from "./durable-images.ts";
import { submitDurableInput, type DurableInput } from "./durable-input.ts";
import { openDurableWorkspace, WorkspaceConversations, type DurableConversationRecord } from "./durable-workspace.ts";
import { expandWorkspaceSkillCommand } from "./skills.ts";
import type { WorkspaceAgentToolOptions } from "./tools.ts";

const context = BACKGROUND_CONTEXT;
export const DurableHistoryLabels = defineDoc<{ labels: Record<string, string[]> }>({
  kind: "atelier.history-labels", version: 1, scope: "session", initial: () => ({ labels: {} }),
});
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
    // Native abort ends its run without admitting a new inbox boundary. Join
    // saved Stop cleanup before admitting later genuine input into that root.
    await settleStoppedDurableWork(harness);
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
    async function record() {
      return (await harness.snapshot(WorkspaceConversations, context))!.conversations.find(item => item.conversationId === identity.conversationId)!;
    }
    async function branches() {
      const current = await record();
      return current.branches ?? [current.durableId];
    }
    async function tree() {
      assertOpen();
      const nodes = new Map<EntryId, { entry: EntryRecord; parentId?: EntryId; branch: ConversationId }>();
      for (const id of await branches()) {
        const branch = (await harness.conversation(id, context))!;
        const entries: EntryRecord[] = [];
        let cursor: Cursor | undefined;
        do {
          const page = await branch.entries({}, 500, cursor, context);
          entries.push(...page.items);
          cursor = page.next;
        } while (cursor);
        entries.reverse();
        entries.forEach((entry, index) => {
          if (!nodes.has(entry.id)) nodes.set(entry.id, { entry, parentId: entries[index - 1]?.id, branch: id });
        });
      }
      const active = (await conversation.entries({}, 1, undefined, context)).items[0]?.id;
      const labels = (await harness.snapshot(DurableHistoryLabels, context))?.labels ?? {};
      return { nodes: [...nodes.values()].sort((a, b) => a.entry.id - b.entry.id), active, labels: Object.fromEntries([...nodes.keys()].flatMap(id => labels[String(id)] ? [[String(id), labels[String(id)]!]] : [])) };
    }
    async function assertIdle() {
      const live = await harness.snapshot(LiveDoc, conversation.id, context);
      const inbox = await harness.snapshot(InboxDoc, conversation.id, context);
      const tasks = (await harness.inspect(context)).tasks;
      if (live?.run || live?.compactions?.length || inbox?.items.length || tasks.some(item => item.record.conversationId === conversation.id)) {
        throw new Error("Stop the agent and wait for its work to finish before navigating history.");
      }
    }
    async function navigate(entryId: string, before: boolean) {
      await assertIdle();
      const history = await tree();
      const selected = history.nodes.find(node => String(node.entry.id) === entryId);
      if (!selected) throw new Error("History entry no longer exists.");
      const target = before ? history.nodes.find(node => node.entry.id === selected.parentId) : selected;
      if (!target) throw new Error("Cannot rewind past the first history entry.");
      const next = await harness.commit(async tx => {
        assertAdmission();
        const catalog = await tx.doc(WorkspaceConversations);
        const current = catalog.conversations.find(item => item.conversationId === identity.conversationId)!;
        const fork = await tx.forkConversation(target.branch, target.entry.id, { ownership: { kind: "ownerless" } });
        current.branches = [...(current.branches ?? [current.durableId]), fork.id];
        current.durableId = fork.id;
        return fork.id;
      }, context);
      conversation = (await harness.conversation(next, context))!;
    }
    function assertAdmission() {
      assertOpen();
      if (deleted) throw new Error("Durable workspace is deleted");
      if (closed.has(conversation.id)) throw new Error("Durable conversation is closed");
    }
    function command<T>(run: () => Promise<T>, metadataOnly = false): Promise<T> {
      const result = tail.then(() => {
        assertAdmission();
        if (identity.readOnly && !metadataOnly) throw new AtelierCoreError("invalid_arguments", "This conversation is read-only. Start a new Agent conversation to continue.");
        return run();
      });
      // The caller receives the rejection; a rejected command must not poison
      // the command line and prevent a later correction or Stop.
      tail = result.then(() => {}, () => {});
      return result;
    }

    async function known(requestId: string) {
      for (const id of await branches()) {
        const found = await harness.commit(tx => tx.submissionByRequest(id, requestId), context);
        if (found) return found;
      }
      return undefined;
    }
    commandDrains.add(() => tail);
    return {
      get id() { return conversation.id; },
      readOnly: Boolean(identity.readOnly),
      tree,
      async historyView(branchId?: string) {
        const ids = await branches();
        const id = branchId === undefined ? conversation.id : ids.find(id => String(id) === branchId);
        if (id === undefined) throw new Error("History branch no longer exists.");
        return harness.commit(async tx => {
          const entries: EntryRecord[] = [];
          let cursor: Cursor | undefined;
          do {
            const page = await tx.scanEntries({ conversationId: id }, 500, cursor);
            entries.push(...page.items);
            cursor = page.next;
          } while (cursor);
          // SAFETY: These native JSON documents are typed by Harness. Detach transaction
          // overlays before commit settles; returning their proxies would invalidate the view.
          return JSON.parse(JSON.stringify({
            conversation: (await tx.conversation(id))!, entries: entries.reverse(),
            docs: {
              [AgentDoc.definition.kind]: await tx.doc(AgentDoc, id),
              [LiveDoc.definition.kind]: await tx.doc(LiveDoc, id),
              [InboxDoc.definition.kind]: await tx.doc(InboxDoc, id),
              [UsageDoc.definition.kind]: await tx.doc(UsageDoc, id),
            },
          })) as ConversationView;
        }, context);
      },
      navigate(entryId: string, before = false) { return command(() => navigate(entryId, before)); },
      label(entryId: string, label: string, operation: "add" | "remove") {
        return command(async () => {
          const node = (await tree()).nodes.find(node => String(node.entry.id) === entryId);
          if (!node) throw new Error("History entry no longer exists.");
          await harness.commit(async tx => {
            const doc = await tx.doc(DurableHistoryLabels);
            const existing = doc.labels[entryId] ?? [];
            doc.labels[entryId] = operation === "add" ? [...new Set([...existing, label.trim()])] : existing.filter(value => value !== label.trim());
          }, context);
        });
      },
      /** Fence immediately, persist before cancellation, retain passive history. */
      close() {
        assertOpen();
        closed.add(conversation.id);
        return closing ??= (async () => {
          await tail;
          for (const id of await branches()) closed.add(id);
          await persistGates();
          for (const id of await branches()) await settleTasks(id);
        })().catch((error) => {
          closing = undefined;
          throw error;
        });
      },
      /** Canonical committed state, including partials and queued input. No scheduling. */
      watch: (...args: Parameters<Conversation["watch"]>) => conversation.watch(...args),
      /** Host-owned mount; disposal detaches observation, not execution. */
      presentation: (onCommit?: Parameters<typeof DurableConversationPresentation.attach>[3]) => {
        assertOpen();
        return DurableConversationPresentation.attach(conversation, { workspaceId, conversationId: identity.conversationId, readOnly: identity.readOnly }, context, onCommit);
      },
      history: (...args: Parameters<Conversation["entries"]>) => conversation.entries(...args),
      context: (...args: Parameters<Conversation["context"]>) => conversation.context(...args),
      agent: (...args: Parameters<Conversation["agent"]>) => conversation.agent(...args),
      image(entryId: string, contentIndex: number) {
        return (async () => {
          if (entryId.startsWith("queued-")) return durableImageEndpoint(conversation, entryId, contentIndex, context);
          for (const id of await branches()) {
            const response = await durableImageEndpoint((await harness.conversation(id, context))!, entryId, contentIndex, context);
            if (response.status !== 404) return response;
          }
          return new Response("not found", { status: 404 });
        })();
      },
      /** Commit searchable metadata without creating a second history file. */
      setTitle(title: string) {
        return command(() => harness.commit(async (tx) => {
          const catalog = await tx.doc(WorkspaceConversations);
          const record = catalog.conversations.find((item) => item.durableId === conversation.id)!;
          record.title = title;
          const result = { ...record };
          if (record.branches) result.branches = [...record.branches];
          return result;
        }, context), true);
      },
      knownRequest(requestId: string) {
        return command(async () => Boolean(await known(requestId)));
      },
      submit(input: DurableInput) {
        return command(async () => {
          if (!input.requestId.trim()) throw new Error("A request ID is required for durable input");
          const existing = await known(input.requestId);
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
          // Persist before probing Docker/providers. Recovery applies this exact
          // scope before any progress; later genuine admissions remain allowed.
          await harness.commit(tx => commitDurableStop(tx, conversation.id), context);
          await markGatedDurableWork(harness);
          try {
            await settleTasks(conversation.id);
          } catch (cause) {
            throw new Error("Stop saved. Workspace cleanup is pending until execution is available.", { cause });
          }
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
          await assertIdle();
          await readyForExecution();
          assertAdmission();
          await conversation.reset(undefined, context);
        });
      },
    };
  }

  return {
    /** Atomic passive import. No prompts, submissions, model calls, or task replay. */
    async importHistory(identity: Pick<DurableConversationRecord, "conversationId" | "label" | "title">, entries: readonly EntryDraft[]) {
      assertOpen();
      return harness.commit(async tx => {
        assertOpen();
        const catalog = await tx.doc(WorkspaceConversations);
        const existing = catalog.conversations.find(record => record.conversationId === identity.conversationId);
        if (existing) return existing.durableId;
        if (deleted) throw new Error("Durable workspace is deleted");
        const created = await tx.createConversation({ ownership: { kind: "ownerless" } });
        for (const entry of entries) await tx.appendEntry(created.id, entry);
        catalog.conversations.push({ conversationId: identity.conversationId, label: identity.label, title: identity.title, durableId: created.id, readOnly: true });
        return created.id;
      }, context);
    },
    async admission() { assertOpen(); return harness.snapshot(WorkspaceAdmission, context); },
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
          return controller(await workspace.conversation(record, prepared), existing ?? record);
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

export type DurableAgentRuntime = Awaited<ReturnType<typeof openDurableAgentRuntime>>;
