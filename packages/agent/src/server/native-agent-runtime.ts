import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { durableContextTokens } from "./durable-accounting.ts";
import { contextUsagePercent } from "./runtime-status.ts";
import { renderDurableTree } from "./durable-tree.ts";
import type { TreeFilterMode } from "./session-tree.ts";
import { AtelierCoreError } from "@atelier/core";
import { createPiModelRuntime, getAgentModelThinkingLevel } from "@atelier/llm/server";
import { createLivePresentation } from "@atelier/shared";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { DurableAgentRuntime } from "./durable-runtime.ts";
import type { DurableConversationPresentation } from "./durable-presentation.ts";
import { durableWorkspaceOwner } from "./durable-owner.ts";
import { configuredModelOptionViews } from "./model-state.ts";
import { renderWorkspaceCompletionCatalog } from "./completion-catalog.ts";
import { renderNotice } from "./render-notice.ts";
import { ids } from "./render-context.ts";
import { renderAgentPaneComposerFooter, renderPromptActions, type AgentStatsView } from "./render-composer.ts";
import { notificationControlId, renderNotificationControl } from "./render-notification.ts";
import { publishWorkspaceAgentBusy } from "./workspace-agent-busy.ts";
import { startNotificationTurn, finishNotificationTurn } from "./turn-notifications.ts";
import { sendTurnNotification } from "./web-push.ts";
import type { WorkspaceAgentConversationInfo } from "./session-store.ts";
import type { AgentLivePresentationListener, SubmitOptions, WorkspaceAgentRuntime, WorkspaceAgentRuntimeOptions } from "./runtime-types.ts";

type Controller = Awaited<ReturnType<DurableAgentRuntime["conversation"]>>;

/** Host chrome wraps committed native views; it never synthesizes transcript events. */
export class NativeAgentRuntime implements WorkspaceAgentRuntime {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly label: string;
  readonly sessionFile: string;
  readonly readOnly: boolean;
  private presentation!: DurableConversationPresentation;
  private readonly transcriptListeners = new Map<AgentLivePresentationListener, { unsubscribe(): void }>();
  readonly treeSummaryAvailable = false;
  private selectionTail: Promise<void> = Promise.resolve();
  model?: { provider: string; id: string };
  private thinking = "off";
  private models: AgentStatsView["models"] = [];
  private catalog = "";
  private busy = false;
  private contextTokens = 0;
  private disposed = false;
  private failure?: Error;
  private readonly chrome = createLivePresentation(() => [
    { target: ids.actions(this), html: renderPromptActions(this, this.isStreaming) },
    { target: ids.stats(this), html: renderAgentPaneComposerFooter(this, this.stats()), morph: false },
    { target: ids.completionCatalog(this), html: this.catalog },
    { target: notificationControlId(this), html: renderNotificationControl(this, this.isStreaming), action: "replace" },
    ...(this.failure ? [{ target: ids.notices(this), html: renderNotice("error", "This Agent view disconnected. Reload to reconnect.") }] : []),
  ], 50);

  private constructor(agent: WorkspaceAgentConversationInfo, private readonly controller: Controller, private readonly modelRuntime: Awaited<ReturnType<typeof createPiModelRuntime>>, private readonly options: WorkspaceAgentRuntimeOptions) {
    this.workspaceId = agent.workspaceId;
    this.conversationId = agent.conversationId;
    this.label = agent.label;
    this.sessionFile = agent.path;
    this.readOnly = controller.readOnly;
  }
  static async create(agent: WorkspaceAgentConversationInfo, options: WorkspaceAgentRuntimeOptions) {
    const owner = await durableWorkspaceOwner(agent.workspaceId, options);
    const controller = await owner.conversation(agent);
    const runtime = new NativeAgentRuntime(agent, controller, await createPiModelRuntime(), options);
    runtime.presentation = await controller.presentation(() => runtime.committed());
    await runtime.committed();
    if (!runtime.readOnly) await runtime.refreshModelConfiguration();
    runtime.observePresentation();
    return runtime;
  }
  private observePresentation() {
    const runtime = this;
    const observed = this.presentation;
    void observed.closed.then(result => {
      if (runtime.disposed || runtime.presentation !== observed) return;
      runtime.failure = new Error(`Native conversation observation ended: ${JSON.stringify(result)}`);
      console.error(runtime.failure);
      runtime.publishBusy(false);
    });
  }
  private async attachSelectedBranch() {
    const previous = this.presentation;
    const next = await this.controller.presentation(() => this.committed());
    if (this.disposed) { await next.dispose(); throw new Error("Agent view is detached"); }
    this.presentation = next;
    this.observePresentation();
    for (const [listener, subscription] of this.transcriptListeners) {
      subscription.unsubscribe();
      this.transcriptListeners.set(listener, this.presentation.subscribeLivePresentation(listener));
    }
    await previous.dispose();
    await this.committed();
    await this.refreshModelConfiguration();
  }
  private assertOpen() {
    if (this.failure) throw this.failure;
    if (this.disposed) throw new Error("Agent view is detached");
  }
  private publishBusy(busy: boolean) {
    if (busy === this.busy) return;
    this.busy = busy;
    publishWorkspaceAgentBusy({ workspaceId: this.workspaceId, agentKey: `agent:${this.conversationId}`, busy });
    this.chrome.invalidate();
  }
  private async committed() {
    // attach starts the watch before returning its initial frame.
    if (!this.presentation || this.disposed) return;
    if (this.readOnly) return;
    const { agent } = this.presentation.state;
    this.model = agent.model ? { provider: agent.model.provider, id: agent.model.modelId } : undefined;
    this.thinking = agent.thinkingLevel ?? "off";
    const wasBusy = this.busy;
    this.publishBusy(this.presentation.busy);
    if (!wasBusy && this.busy) startNotificationTurn(this, () => this.chrome.invalidate());
    if (wasBusy && !this.busy) {
      const subscription = finishNotificationTurn(this);
      if (subscription) void sendTurnNotification(this, subscription).catch(error => console.error("Could not send Agent notification", error));
      await this.options.events?.emit("workspace_agent_turn_finished", { workspaceId: this.workspaceId, conversationId: this.conversationId });
    }
    this.contextTokens = durableContextTokens(await this.controller.context(BACKGROUND_CONTEXT));
    this.chrome.invalidate();
  }
  get isStreaming() { return this.busy; }
  currentModel() { return this.model; }
  currentThinkingLevel() { return this.thinking; }
  availableThinkingLevels() {
    const model = this.model && this.modelRuntime.getModel(this.model.provider, this.model.id);
    return model ? getSupportedThinkingLevels(model) : [];
  }
  private stats(): AgentStatsView {
    const usage = this.presentation.state.usage;
    const buckets = [...Object.values(usage.models), ...Object.values(usage.tools)];
    const model = this.model && this.modelRuntime.getModel(this.model.provider, this.model.id);
    return { nativeBranchUsage: true, contextPercent: contextUsagePercent(undefined, this.contextTokens, model?.contextWindow), compactAvailable: !this.isStreaming && Boolean(this.model),
      inputTokens: buckets.reduce((sum, item) => sum + item.input, 0), outputTokens: buckets.reduce((sum, item) => sum + item.output, 0),
      cost: buckets.reduce((sum, item) => sum + item.cost.total, 0), modelName: this.model?.id,
      thinkingLevel: this.thinking, thinkingLevels: this.availableThinkingLevels(), models: this.models.map(model => ({ ...model, selected: model.provider === this.model?.provider && model.id === this.model.id })) };
  }
  subscribeLivePresentation(listener: AgentLivePresentationListener) {
    this.assertOpen();
    this.transcriptListeners.set(listener, this.presentation.subscribeLivePresentation(listener));
    const chrome = this.chrome.subscribe(listener);
    return { unsubscribe: () => { this.transcriptListeners.get(listener)?.unsubscribe(); this.transcriptListeners.delete(listener); chrome.unsubscribe(); } };
  }
  subscribeTurnPresentation(turn: string, branch: string, listener: AgentLivePresentationListener) { this.assertOpen(); return this.presentation.subscribeTurnPresentation(turn, branch, listener); }
  async paneState() { this.assertOpen(); return { transcriptHtml: this.presentation.transcriptHtml(), busy: this.isStreaming, stats: this.stats(), readOnly: this.readOnly }; }
  async refreshCompletionCatalog() { if (this.readOnly) return ""; this.catalog = await renderWorkspaceCompletionCatalog(this.workspaceId); this.chrome.invalidate(); return this.catalog; }
  revealTurn(target: string) { return this.presentation.revealTurn(target); }
  userMessages() { return this.presentation.userMessages(); }
  knownRequest(requestId: string) { this.assertOpen(); return this.controller.knownRequest(requestId); }
  image(entry: string, index: number) { return this.controller.image(entry, index); }
  async submit(text: string, options: SubmitOptions = {}) {
    this.assertOpen();
    const requestId = options.requestId ?? crypto.randomUUID();
    if (await this.controller.knownRequest(requestId)) return;
    await this.requireAvailableModel();
    await this.controller.submit({ text, requestId, attachmentNotes: options.attachmentNotes,
      images: options.images?.map(image => ({ type: "image", data: image.data, mimeType: image.mimeType })) });
  }
  private assertWritable() {
    this.assertOpen();
    if (this.readOnly) throw new AtelierCoreError("invalid_arguments", "This conversation is read-only. Start a new Agent conversation to continue.");
  }
  private async requireAvailableModel() {
    this.assertWritable();
    const model = this.currentModel();
    const available = model && (await configuredModelOptionViews(model, this.modelRuntime)).find(item => item.provider === model.provider && item.id === model.id);
    if (!available?.available) throw new AtelierCoreError("invalid_arguments", available?.unavailableReason ?? "Choose a connected model in Settings → Models");
  }
  async compact(instructions?: string) { this.assertOpen(); await this.requireAvailableModel(); await this.controller.compact(instructions); }
  async abort() { this.assertOpen(); await this.controller.stop(); }
  async newSession() { this.assertOpen(); await this.controller.reset(); }
  async refreshModelConfiguration() { if (this.readOnly) return; this.models = await configuredModelOptionViews(this.currentModel() ?? null, this.modelRuntime); this.chrome.invalidate(); }
  async setModel(provider: string, modelId: string) {
    this.assertWritable();
    const model = (await configuredModelOptionViews({ provider, id: modelId }, this.modelRuntime)).find(item => item.provider === provider && item.id === modelId);
    if (!model?.available) throw new AtelierCoreError("invalid_arguments", model?.unavailableReason ?? "Model unavailable");
    const remembered = await getAgentModelThinkingLevel("builtin", { provider, id: modelId });
    const resolved = this.modelRuntime.getModel(provider, modelId)!;
    const thinkingLevel = getSupportedThinkingLevels(resolved).find(level => level === remembered);
    await this.controller.configure({ model: { provider, modelId }, thinkingLevel });
    this.model = { provider, id: modelId };
    if (thinkingLevel) this.thinking = thinkingLevel;
    await this.refreshModelConfiguration();
  }
  async setThinkingLevel(level: string) {
    this.assertWritable();
    const selected = this.availableThinkingLevels().find(item => item === level);
    if (!selected) throw new AtelierCoreError("invalid_arguments", `Unsupported thinking level: ${level}`);
    await this.controller.configure({ thinkingLevel: selected });
    this.thinking = selected;
    this.chrome.invalidate();
  }
  async detailHtml(key: string, count?: number) { return this.presentation.detailHtml(key, count); }
  async treeHtml(options: { filter: TreeFilterMode; query: string }) { this.assertOpen(); return renderDurableTree(await this.controller.tree(), { ...options, historyPath: `/workspaces/${encodeURIComponent(this.workspaceId)}/agent-history` }); }
  async labelTreeEntry(entryId: string, label: string, operation: "add" | "remove") { this.assertOpen(); await this.controller.label(entryId, label, operation); }
  private selectBranch(entryId: string, before = false) {
    const selected = this.selectionTail.then(async () => {
      this.assertOpen();
      await this.controller.navigate(entryId, before);
      await this.attachSelectedBranch();
    });
    this.selectionTail = selected.then(() => {}, () => {});
    return selected;
  }
  async navigateTree(entryId: string, options: { summarize: boolean }): Promise<string> {
    this.assertOpen();
    if (options.summarize) throw new AtelierCoreError("invalid_arguments", "Continue without a summary for native history.");
    await this.selectBranch(entryId);
    return "";
  }
  async rewind(entryId: string, mode: "discard" | "summary"): Promise<void> {
    this.assertOpen();
    if (mode === "summary") throw new AtelierCoreError("invalid_arguments", "Continue without a summary for native history.");
    await this.selectBranch(entryId, true);
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.chrome.dispose();
    finishNotificationTurn(this);
    this.publishBusy(false);
    await this.presentation.dispose();
  }
}
