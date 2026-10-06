import { createHash } from "node:crypto";
import { createKeyedOperationQueue, invalidArguments, type AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import { workspaceRoot } from "@agents-in-the-cloud/workspace";
import { createLivePresentation, type WorkspaceAgentInput } from "@agents-in-the-cloud/shared";
import { parseModelRef, setAgentModelPreference } from "@agents-in-the-cloud/llm/server";
import { publishWorkspaceAgentBusy } from "@agents-in-the-cloud/agent/server/workspace-agent-busy";
import { revokeAgentMcp } from "@agents-in-the-cloud/agent/server";
import type {
  UserInput,
  TurnStartParams,
  Model,
  ModelListResponse,
} from "../protocol.ts";
import type { CodexNotification } from "./protocol.ts";
import { CodexRpcError } from "./rpc.ts";
import { CodexState } from "./state.ts";
import { openCodexTransport } from "./transport.ts";
import { agentTypeId, label, codexHome, prepareCodex, settings } from "./setup.ts";
import { createCodexStore, type CodexAgentRecord } from "./store.ts";
import { liveRegions } from "./render.ts";

export class CodexRuntime {
  readonly state = new CodexState();
  instructions = "";
  private catalog: Model[] = [];
  failure?: Error;
  private transport!: Awaited<ReturnType<typeof openCodexTransport>>;
  private disposed = false;
  private closing = false;
  private threadId!: string;
  private busy = false;
  private readonly serialize = createKeyedOperationQueue();
  readonly presentation = createLivePresentation(() => liveRegions(this), 50);
  private constructor(readonly workspaceId: string, readonly record: CodexAgentRecord, private readonly save: () => void, private readonly events: AgentsInTheCloudEventBus) {}
  get agentId() { return this.record.id; }
  get isBusy() { return !this.failure && Boolean(this.state.activeTurn); }
  private changed() {
    if (this.disposed) return;
    const busy = this.isBusy;
    if (busy !== this.busy) {
      this.busy = busy;
      publishWorkspaceAgentBusy({ workspaceId: this.workspaceId, agentKey: `agent:${this.agentId}`, busy });
      if (!busy) void this.events.emit("workspace_agent_turn_finished", { workspaceId: this.workspaceId, agentId: this.agentId }).catch(error => console.error("Could not publish Codex turn completion", error));
    }
    this.presentation.invalidate();
  }
  static async open(workspaceId: string, record: CodexAgentRecord, save: () => void, events: AgentsInTheCloudEventBus) {
    const runtime = new CodexRuntime(workspaceId, record, save, events);
    try { await runtime.connect(); return runtime; }
    catch (error) { await runtime.dispose(); throw error; }
  }
  async reconnect() {
    return this.serialize(this.agentId, async () => {
      if (!this.failure) return;
      if (this.disposed || this.closing) throw new Error("Codex Agent is closed");
      await this.transport.close();
      this.failure = undefined;
      await this.connect();
    });
  }
  private async connect() {
    const queued: CodexNotification[] = [];
    let ready = false;
    try {
      this.instructions = await prepareCodex(this.workspaceId, this.agentId);
      this.transport = await openCodexTransport(this.workspaceId, codexHome(this.agentId), notification => {
        if (!ready) queued.push(notification);
        else {
          this.receive(notification);
        }
      }, error => { this.failure = error; this.changed(); });
      const { rpc } = this.transport;
      await rpc.request("initialize", { clientInfo: { name: "agents_in_the_cloud", title: "AgentsInTheCloud", version: "1.0.0" }, capabilities: null });
      rpc.notify("initialized");
      const common = this.threadParameters;
      const resume = Boolean(this.record.threadId && this.record.submissions.length);
      const response = resume
        ? await rpc.request("thread/resume", { threadId: this.record.threadId!, ...common })
        : await rpc.request("thread/start", common);
      this.threadId = response.thread.id;
      this.catalog = [];
      this.record.model = `openai-codex::${response.model}`;
      this.record.thinkingLevel ??= response.reasoningEffort ?? undefined;
      let modelCursor: string | null = null;
      do {
        const page: ModelListResponse = await rpc.request("model/list", { cursor: modelCursor, includeHidden: true });
        this.catalog.push(...page.data);
        modelCursor = page.nextCursor;
      } while (modelCursor);
      this.record.thinkingLevel ??= this.selectedModel?.defaultReasoningEffort;
      this.save();
      // The pinned server uses legacy history. Its stable resume/read operations
      // hydrate native turns; experimental item pagination is not supported.
      this.state.hydrate(response.thread.turns);
      for (const notification of queued) this.receive(notification);
      ready = true;
      this.changed();
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
      this.changed();
      await this.transport?.close();
      throw error;
    }
  }
  async send(input: WorkspaceAgentInput, requestId: string) {
    return this.serialize(this.agentId, async () => {
      this.assertOpen();
      const parts: UserInput[] = [{ type: "text", text: [input.text, ...input.attachmentNotes].filter(Boolean).join("\n\n"), text_elements: [] }, ...input.images.map(image => ({ type: "image" as const, url: `data:${image.mimeType};base64,${image.data}` }))];
      const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
      const previous = this.record.submissions.find(entry => entry.id === requestId);
      if (previous) {
        if (previous.digest !== digest) throw invalidArguments("This request ID was already used for a different prompt");
        if (previous.accepted || this.state.turns.some(turn => turn.items.some(item => item.type === "userMessage" && item.clientId === requestId))) return;
        throw invalidArguments("The previous send has an uncertain outcome. Reload to inspect the conversation before sending again.");
      }
      const submission = { id: requestId, digest, accepted: false };
      this.record.submissions.push(submission);
      this.record.threadId = this.threadId;
      this.save();
      const active = this.state.activeTurn;
      try {
        if (active) await this.transport.rpc.request("turn/steer", { threadId: this.threadId, expectedTurnId: active.id, clientUserMessageId: requestId, input: parts });
        else {
          // SAFETY: The launch picker or native catalog validates the stored reasoning effort.
          const params: TurnStartParams = { threadId: this.threadId, clientUserMessageId: requestId, input: parts, model: this.record.model ? parseModelRef(this.record.model)!.id : undefined, effort: this.record.thinkingLevel as TurnStartParams["effort"] };
          const response = await this.transport.rpc.request("turn/start", params);
          if (!this.state.turns.some(turn => turn.id === response.turn.id)) this.state.receive({ method: "turn/started", params: { threadId: this.threadId, turn: response.turn } });
        }
      } catch (error) {
        // A server rejection did not admit the prompt. A lost connection is
        // uncertain and keeps the durable claim so retries cannot duplicate it.
        if (error instanceof CodexRpcError) {
          this.record.submissions = this.record.submissions.filter(entry => entry !== submission);
          this.save();
        }
        throw error;
      }
      submission.accepted = true;
      this.save();
      const turnId = active?.id ?? this.state.activeTurn?.id ?? this.state.turns.at(-1)?.id;
      if (turnId) await this.refreshTurnItems(turnId, !this.state.activeTurn);
      this.changed();
    });
  }
  async stop() { this.assertOpen(); const turn = this.state.activeTurn; if (turn) await this.transport.rpc.request("turn/interrupt", { threadId: this.threadId, turnId: turn.id }); }
  async configure(parameters: { model?: string; thinkingLevel?: string }) {
    return this.serialize(this.agentId, async () => {
      this.assertOpen();
      if (this.isBusy) throw invalidArguments("Stop Codex before changing its model or thinking level");
      const modelId = parameters.model ? parseModelRef(parameters.model) : parseModelRef(this.record.model!);
      const model = modelId?.provider === "openai-codex" && this.catalog.find(model => model.model === modelId.id);
      if (!model) throw invalidArguments("Choose an available Codex model");
      const effort = parameters.thinkingLevel ?? (parameters.model ? model.defaultReasoningEffort : this.record.thinkingLevel ?? model.defaultReasoningEffort);
      if (!model.supportedReasoningEfforts.some(option => option.reasoningEffort === effort)) throw invalidArguments("Unsupported Codex thinking level");
      this.record.model = `openai-codex::${model.model}`;
      this.record.thinkingLevel = effort;
      await setAgentModelPreference(agentTypeId, { provider: "openai-codex", id: model.model }, effort);
      this.save();
      this.changed();
    });
  }
  async reset() {
    return this.serialize(this.agentId, async () => {
      this.assertOpen();
      if (this.isBusy) throw invalidArguments("Stop Codex before starting a fresh session");
      const response = await this.transport.rpc.request("thread/start", this.threadParameters);
      this.threadId = response.thread.id;
      delete this.record.threadId;
      this.state.hydrate([]);
      this.state.usage = undefined;
      this.state.notices.length = 0;
      this.save();
      this.changed();
    });
  }
  async rename(title: string) {
    this.record.title = title;
    this.save();
    await this.events.emit("workspace_agent_title_changed", { workspaceId: this.workspaceId, agentId: this.agentId, title });
  }
  async close() {
    this.closing = true;
    await this.serialize(this.agentId, async () => {
      const turn = this.state.activeTurn;
      if (turn && !this.failure) await this.transport.rpc.request("turn/interrupt", { threadId: this.threadId, turnId: turn.id });
      await this.dispose();
    });
  }
  private receive(notification: CodexNotification) {
    if (this.disposed) return;
    // Codex can publish native subagent activity too. Only this root owns this pane.
    if ("threadId" in notification.params && notification.params.threadId !== this.threadId) return;
    this.state.receive(notification);
    this.changed();
    if (notification.method === "turn/completed") void this.refreshTurnItems(notification.params.turn.id, true).catch(error => { this.failure = error; this.changed(); });
  }
  private get threadParameters() {
    return { model: this.record.model ? parseModelRef(this.record.model)!.id : undefined, cwd: workspaceRoot, approvalPolicy: "never" as const, sandbox: "danger-full-access" as const, developerInstructions: this.instructions };
  }
  private get selectedModel() {
    const id = this.record.model ? parseModelRef(this.record.model)?.id : undefined;
    return this.catalog.find(model => model.model === id);
  }
  get selection() {
    const selected = this.selectedModel;
    return {
      models: this.catalog.filter(model => !model.hidden || model === selected).map(model => ({ provider: "openai-codex", id: model.model, name: model.displayName, selected: model === selected, available: true })),
      thinkingLevels: selected?.supportedReasoningEfforts.map(option => option.reasoningEffort) ?? [],
    };
  }
  private async refreshTurnItems(turnId: string, completed: boolean) {
    const threadId = this.threadId;
    const response = await this.transport.rpc.request("thread/read", { threadId, includeTurns: true });
    // A fresh-session command can replace the thread while this read is in flight.
    if (threadId !== this.threadId) return;
    const turn = response.thread.turns.find(turn => turn.id === turnId);
    if (!turn) throw new Error(`Codex history is missing turn ${turnId}`);
    this.state.hydrateItems(turnId, turn.items, completed);
    this.changed();
  }
  private assertOpen() { if (this.failure) throw this.failure; if (this.disposed || this.closing) throw new Error("Codex Agent is closed"); }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await this.transport?.close();
    if (this.busy) publishWorkspaceAgentBusy({ workspaceId: this.workspaceId, agentKey: `agent:${this.agentId}`, busy: false });
    this.presentation.dispose();
  }
}

export function createCodexAgents(getEvents: () => AgentsInTheCloudEventBus) {
  let metadata: ReturnType<typeof createCodexStore> | undefined;
  function store() { return metadata ??= createCodexStore(); }
  const runtimes = new Map<string, Promise<CodexRuntime>>();
  const serialize = createKeyedOperationQueue();
  async function ready(workspaceId: string, agentId: string) {
    const record = store().get(workspaceId, agentId);
    let runtime = runtimes.get(agentId);
    if (!runtime) {
      runtime = CodexRuntime.open(workspaceId, record, () => store().save(workspaceId), getEvents());
      runtimes.set(agentId, runtime);
      void runtime.catch(() => { if (runtimes.get(agentId) === runtime) runtimes.delete(agentId); });
    }
    const opened = await runtime;
    if (opened.failure) await opened.reconnect();
    return opened;
  }
  async function create(workspaceId: string, parameters: { model?: string; thinkingLevel?: string; input?: WorkspaceAgentInput } = {}) {
    return serialize(workspaceId, async () => {
      const selected = await settings.prepare({ model: parameters.model ?? "", thinkingLevel: parameters.thinkingLevel ?? "" });
      const record: CodexAgentRecord = { id: crypto.randomUUID(), title: label, ...selected, submissions: [] };
      store().add(workspaceId, record);
      const runtime = await ready(workspaceId, record.id);
      const input = parameters.input;
      if (input && (input.text.trim() || input.images.length || input.attachmentNotes.length)) await runtime.send(input, `launch-${record.id}`);
      return record.id;
    });
  }
  async function close(workspaceId: string, agentId: string) {
    return serialize(workspaceId, async () => {
      store().get(workspaceId, agentId);
      const runtime = runtimes.get(agentId);
      if (runtime) await (await runtime).close();
      runtimes.delete(agentId);
      await revokeAgentMcp(workspaceId, agentId);
      store().remove(workspaceId, agentId);
    });
  }
  async function disposeWorkspace(workspaceId: string) {
    for (const record of store().list(workspaceId)) {
      const runtime = runtimes.get(record.id);
      if (runtime) { await (await runtime).dispose(); runtimes.delete(record.id); }
      await revokeAgentMcp(workspaceId, record.id);
    }
  }
  async function disposeAll() {
    await Promise.all([...runtimes.values()].map(async runtime => (await runtime).dispose()));
    runtimes.clear();
  }
  return { list: (workspaceId: string) => store().list(workspaceId), ready, create, close, disposeWorkspace, disposeAll };
}
export type CodexAgents = ReturnType<typeof createCodexAgents>;
