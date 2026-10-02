export {
  archiveWorkspaceAgentConversation,
  createNextWorkspaceAgentConversation,
  ensureDefaultWorkspaceAgentConversation,
  listWorkspaceAgentConversations,
  publishSessionSnapshot,
  sessionShareDir,
  workspaceSessionShareKey,
  sessionShareMountPath,
  setWorkspaceAgentConversationTitle,
  untitledAgentConversationTitle,
  type WorkspaceAgentConversationInfo,
} from "./session-store.ts";
export {
  getWorkspaceAgentPresentation,
  getWorkspaceAgentController,
  unloadWorkspaceAgentPresentation,
  closeWorkspaceAgentConversation,
  removeWorkspaceAgentRuntimes,
  subscribeWorkspaceAgentBusy,
  type AgentLivePresentationSubscription,
} from "./runtime.ts";
export { registerAgentEvents } from "./agent-events.ts";
export { suggestSessionSlug } from "./agent-title-suggestion.ts";
export { handleAgentRequest } from "./routes.ts";
export { workspaceFileEndpoint } from "./workspace-files.ts";
export { agentConversationKey } from "./render-context.ts";
export { renderReadOnlyTranscript, renderReadOnlyTranscriptDetail } from "./read-only-transcript.ts";
export { recordsFromSessionEntries } from "./session-records.ts";
export { renderWorkspaceCompletionCatalog } from "./completion-catalog.ts";
export { listFileCompletions, renderFileCompletionMenu } from "./file-completions.ts";
export { expandPromptTemplate } from "./prompt-templates.ts";
export { runAgentSessionNameCommand } from "./session-name-command.ts";
export { agentWorkspaceModule, agentWorkspaceModule as atelierServerModule, workspaceAgentTabProvider } from "./web.ts";
export {
  createDeleteCurrentWorkspaceTool,
  normalizeWorkspacePath,
  registerWorkspaceAgentTool,
  registerWorkspacePresenter,
  type WorkspacePresenterDefinition,
  type WorkspacePresenterDeps,
} from "./tools.ts";

export { configureAgentDelegation, resolveAgentConversation, type AgentDelegation, type AgentToolPresentation } from "./delegation.ts";
export { ids, type AgentRenderContext } from "./render-context.ts";
export { transcriptRow, transcriptActionItemHtml } from "./render-markup.ts";
export { assistantTextPhase, isFinalAssistantMessage, finalAssistantText, finalAssistantTextIndexes, type TranscriptItem, type TranscriptRecord } from "./transcript.ts";
export { type AgentRouteHandler, requireAgentPresentation } from "./route-support.ts";
export { type AgentTranscriptSnapshot, type AgentTranscriptAnchor } from "./transcript-contributions.ts";


export { maybeNameWorkspaceFromPrompt } from "./agent-title-suggestion.ts";
export { nativeAgentLaunch } from "./launch.ts";
export { hasAvailableBuiltinAgentModel } from "./model-state.ts";

export { prepareAgentMcp, revokeAgentMcp, configureAgentMcp, handleAgentMcpRequest } from "./mcp.ts";

export { WorkspaceConversations, type DurableConversationRecord } from "./durable-workspace.ts";
export { WorkspaceAdmission, WorkspaceStops, DurableTaskAdmissions, commitDurableStop, markGatedDurableWork, settleStoppedDurableWork } from "./durable-lifecycle.ts";
export { durableWorkspaceOwner } from "./runtime.ts";
