import { configuredModelOptionViews } from "./model-state.ts";
import { getAgentModelThinkingLevel } from "@agents-in-the-cloud/llm/server";
import { publishWorkspaceAgentBusy } from "./workspace-agent-busy.ts";
import { startNotificationTurn, finishNotificationTurn } from "./turn-notifications.ts";
import { sendTurnNotification } from "./web-push.ts";
import { durableTimingEntry } from "./durable-timing.ts";
import { AgentsInTheCloudCoreError } from "@agents-in-the-cloud/core";
import { checkWorkspaceReadiness } from "@agents-in-the-cloud/workspace";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { UserEntry, LiveDoc, InboxDoc, AgentDoc, UsageDoc, defineDoc, type Cursor, type EntryId, type EntryRecord, type EntryDraft, type AgentChange, type Conversation, type ConversationId, type ConversationView, type HarnessOptions, type LiveState } from "@earendil-works/pi-durable";
import { createDurableHarnessOptions, prepareDurableConversation } from "./durable-assembly.ts";
import { durableStopScope, commitDurableStop, markGatedDurableWork, settleStoppedDurableWork, WorkspaceAdmission, WorkspaceStops } from "./durable-lifecycle.ts";
import { durableImageEndpoint } from "./durable-images.ts";
import { submitDurableInput, type DurableInput } from "./durable-input.ts";
import { openDurableWorkspace, WorkspaceConversations, type DurableConversationRecord } from "./durable-workspace.ts";
import { expandWorkspaceSkillCommand } from "./skills.ts";
import type { WorkspaceAgentToolOptions } from "./tools.ts";

const context = BACKGROUND_CONTEXT;
export const DurableHistoryLabels = defineDoc<{ labels: Record<string, string[]> }>({
  kind: "agents-in-the-cloud.history-labels", version: 1, scope: "session", initial: () => ({ labels: {} }),
});
type ConversationIdentity = Omit<DurableConversationRecord, "durableId">;
type SettingsChange = Pick<AgentChange, "model"> & { thinkingLevel?: string };

const dependencies = {
  harness: createDurableHarnessOptions,
  prepare: prepareDurableConversation,
  expand: expandWorkspaceSkillCommand,
  ready: checkWorkspaceReadiness,
  async validateModel(ref: AgentChange["model"]) {
    const selected = ref && { provider: ref.provider, id: ref.modelId };
    const model = selected && (await configuredModelOptionViews(selected)).find(item => item.provider === selected.provider && item.id === selected.id);
    if (!model?.available) throw new AgentsInTheCloudCoreError("invalid_arguments", model?.unavailableReason ?? "Choose a connected model in Settings → Models");
  },
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
  const harnessOptions: HarnessOptions = await load.harness(workspaceId, options, async (id, entry, context) => {
    await workspace.harness.commit(async tx => { await tx.appendEntry(durableTimingEntry, id, entry); }, context);
  }, () => workspace.harness);
  const workspace = await openDurableWorkspace(directory, workspaceId, harnessOptions);
  const { harness } = workspace;
  const agents = new Map<string, Promise<Awaited<ReturnType<typeof controller>>>>();
  const observers = new Set<() => Promise<void>>();
  const commandDrains = new Set<() => Promise<void>>();
  const usageListeners = new Set<() => void>();
  const workListeners = new Set<() => void>();
  const taskWatch = await harness.watchTaskGraph(context);
  taskWatch.start(async () => { for (const listener of workListeners) listener(); });
  observers.add(() => taskWatch.stop().then(() => {}));
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
      const records = (await tx.doc(WorkspaceConversations)).conversations;
      const closedRoots = new Set(records.filter(record => (record.branches ?? [record.durableId]).some(id => closed.has(id))).map(record => record.conversationId));
      for (const record of records) if (record.rootId && closedRoots.has(record.rootId)) for (const id of record.branches ?? [record.durableId]) closed.add(id);
      admission.closed = [...closed];
    }, context);
    await markGatedDurableWork(harness);
  }

  function assertOpen() {
    if (suspended) throw new Error("Durable agent runtime is suspended");
  }

  async function controller(conversation: Conversation, identity: ConversationIdentity) {
    // Only host commands queue here, never generation/tool execution. Different
    // roots prepare independently, while model changes cannot race image sizing
    // and skill expansion for this root's next admission.
    let tail: Promise<void> = Promise.resolve();
    let closing: Promise<void> | undefined;
    const selectionListeners = new Set<() => Promise<void>>();
    const statusListeners = new Set<() => void>();
    const renderContext = { workspaceId, conversationId: identity.conversationId };
    let busy = false;
    let observation: Awaited<ReturnType<Conversation["watch"]>> | undefined;
    function statusChanged() { for (const listener of statusListeners) listener(); }
    function publishBusy(value: boolean) {
      busy = value;
      publishWorkspaceAgentBusy({ workspaceId, agentKey: `agent:${identity.conversationId}`, busy });
      statusChanged();
    }
    async function committed(view: ConversationView) {
      for (const listener of usageListeners) listener();
      // SAFETY: Harness owns and versions the LiveDoc in this committed view.
      const live = view.docs[LiveDoc.definition.kind] as LiveState | undefined;
      const nextBusy = Boolean(live?.run || live?.compactions?.length);
      if (nextBusy === busy) return;
      if (nextBusy) startNotificationTurn(renderContext, statusChanged);
      publishBusy(nextBusy);
      if (!nextBusy) {
        const subscription = finishNotificationTurn(renderContext);
        if (subscription) void sendTurnNotification(renderContext, subscription).catch(error => console.error("Could not send Agent notification", error));
        // Completion consumers (review refresh, catalog loading, etc.) do not own
        // execution observation. Report their failure without terminating the watch.
        await options.events?.emit("workspace_agent_turn_finished", renderContext)
          .catch(error => console.error("Could not publish Agent turn completion", error));
      }
    }
    async function observe() {
      if (identity.readOnly) return;
      const previous = observation;
      observation = undefined;
      await previous?.stop();
      assertOpen();
      const watch = await conversation.watch(context);
      if (suspended) { await watch.stop(); assertOpen(); }
      observation = watch;
      await committed(watch.value);
      watch.start(committed);
      void watch.closed.then(result => {
        if (observation !== watch || suspended) return;
        console.error("Agent execution observation ended", result);
        finishNotificationTurn(renderContext);
        publishBusy(false);
      });
    }
    observers.add(async () => {
      const watch = observation;
      observation = undefined;
      await watch?.stop();
      finishNotificationTurn(renderContext);
      if (busy) publishBusy(false);
    });
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
      const records = (await harness.snapshot(WorkspaceConversations, context))!.conversations;
      const scope = new Set([conversation.id, ...records.filter(record => record.rootId === identity.conversationId).map(record => record.durableId)]);
      const tasks = (await harness.inspect(context)).tasks;
      if (live?.run || live?.compactions?.length || inbox?.items.length || tasks.some(item => scope.has(item.record.conversationId) && item.record.kind !== "atelier.delegation-anchor")) {
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
      await observe();
      await Promise.all([...selectionListeners].map(listener => listener()));
    }
    function assertAdmission() {
      assertOpen();
      if (deleted) throw new Error("Durable workspace is deleted");
      if (closed.has(conversation.id)) throw new Error("Durable conversation is closed");
    }
    function command<T>(run: () => Promise<T>, metadataOnly = false): Promise<T> {
      const result = tail.then(() => {
        assertAdmission();
        if (identity.readOnly && !metadataOnly) throw new AgentsInTheCloudCoreError("invalid_arguments", "This conversation is read-only. Start a new Agent conversation to continue.");
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
    await observe();
    return {
      subscribeSelection(listener: () => Promise<void>) { selectionListeners.add(listener); return () => { selectionListeners.delete(listener); }; },
      subscribeStatus(listener: () => void) { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; },
      settings: () => conversation.agent(context),
      get hasStoppableWork() {
        const scope = new Set(durableStopScope(catalogWatch!.value!.conversations, conversation.id, !identity.parentId));
        return Object.values(taskWatch.value.tasks).some(task => scope.has(task.conversationId) && task.kind !== "atelier.delegation-anchor");
      },
      subscribeWork(listener: () => void) { workListeners.add(listener); return () => { workListeners.delete(listener); }; },
      isSubagent: Boolean(identity.parentId),
      subscribeUsage(listener: () => void) { usageListeners.add(listener); return () => { usageListeners.delete(listener); }; },
      async descendantCost() {
        const records = (await harness.snapshot(WorkspaceConversations, context))!.conversations;
        const descendants = new Set([identity.conversationId]);
        let added = true;
        while (added) {
          added = false;
          for (const record of records) if (record.parentId && descendants.has(record.parentId) && !descendants.has(record.conversationId)) { descendants.add(record.conversationId); added = true; }
        }
        descendants.delete(identity.conversationId);
        if (!descendants.size) return undefined;
        let cost = 0;
        for (const record of records.filter(record => descendants.has(record.conversationId))) for (const id of record.branches ?? [record.durableId]) {
          const usage = await harness.snapshot(UsageDoc, id, context);
          for (const value of [...Object.values(usage?.models ?? {}), ...Object.values(usage?.tools ?? {})]) cost += value.cost.total;
        }
        return cost;
      },
      async userMessages() {
        const { entries } = await conversation.context(context);
        return entries.filter(UserEntry.is).flatMap(entry => (entry.model ?? []).flatMap(message => message.role === "user" ? [contentText(message.content)] : []));
      },
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
          for (const id of closed) await settleTasks(id);
        })().catch((error) => {
          closing = undefined;
          throw error;
        });
      },
      /** Canonical committed state, including partials and queued input. No scheduling. */
      watch: (...args: Parameters<Conversation["watch"]>) => conversation.watch(...args),
      history: (...args: Parameters<Conversation["entries"]>) => conversation.entries(...args),
      context: (...args: Parameters<Conversation["context"]>) => conversation.context(...args),
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
          await load.validateModel((await conversation.agent(context)).model);
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
          if (ref && !model) throw new AgentsInTheCloudCoreError("invalid_arguments", `Model not found: ${ref.provider}/${ref.modelId}`);
          if (change.model !== undefined) await load.validateModel(ref);
          const levels = model ? getSupportedThinkingLevels(model) : [];
          const requested = change.thinkingLevel ?? (change.model ? await getAgentModelThinkingLevel("builtin", { provider: change.model.provider, id: change.model.modelId }) : undefined);
          const thinkingLevel = levels.find(level => level === requested);
          if (change.thinkingLevel !== undefined && !thinkingLevel) throw new AgentsInTheCloudCoreError("invalid_arguments", `Unsupported thinking level: ${change.thinkingLevel}`);
          await conversation.configure({ ...change, thinkingLevel }, context);
        });
      },
      /** Explicit Stop withdraws queued input and cancels owned work. */
      stop() {
        return command(async () => {
          // Persist before probing Docker/providers. Recovery applies this exact
          // scope before any progress; later genuine admissions remain allowed.
          await harness.commit(tx => commitDurableStop(tx, conversation.id, !identity.parentId), context);
          await markGatedDurableWork(harness);
          try {
            const stopped = new Set(Object.values((await harness.snapshot(WorkspaceStops, context))?.tasks ?? {}).flat());
            if ((await harness.inspect(context)).tasks.some(({ record }) => stopped.has(record.id))) await readyForExecution();
          } catch (cause) {
            throw new Error("Stop saved. Workspace cleanup is pending until execution is available.", { cause });
          }
        });
      },
      compact(instructions?: string) {
        return command(async () => {
          await load.validateModel((await conversation.agent(context)).model);
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

  const catalogWatch = await harness.watchDoc(WorkspaceConversations, context);
  catalogWatch!.start(async value => {
    if (suspended) return;
    for (const listener of workListeners) listener();
    for (const record of value?.conversations ?? []) {
      if (!record.parentId || record.readOnly || agents.has(record.conversationId)) continue;
      const pending = (async () => controller((await harness.conversation(record.durableId, context))!, record))();
      agents.set(record.conversationId, pending);
      await pending;
    }
  });
  observers.add(async () => { await catalogWatch!.stop(); });

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
    /** Trusted native module access; public routes expose only scoped operations. */
    get harness() { return harness; },
    /** Discover retained histories without preparing prompts or starting work. */
    async catalog() {
      assertOpen();
      return (await harness.snapshot(WorkspaceConversations, context))!.conversations;
    },
    /** Reuse one host command line per AgentsInTheCloud UUID; reopening never rebuilds its prompt. */
    conversation(record: ConversationIdentity, initial: Pick<AgentChange, "model" | "thinkingLevel"> = {}) {
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
      const catalog = (await harness.snapshot(WorkspaceConversations, context))!;
      await Promise.all(catalog.conversations.filter(record => !record.readOnly && !closed.has(record.durableId)).map(record => this.conversation(record)));
      await readyForExecution();
      harness.resume();
    },
    /** Host shutdown/unload: stop observation and scheduling, not the task's effects. */
    async suspend() {
      suspended = true;
      await Promise.all([...observers].map(stop => stop()));
      await workspace.close();
    },
  };
}

export type DurableAgentRuntime = Awaited<ReturnType<typeof openDurableAgentRuntime>>;
