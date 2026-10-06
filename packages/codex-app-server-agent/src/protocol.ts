// GENERATED CODE! DO NOT MODIFY BY HAND!
// Codex 0.160.1; regenerate with bun packages/codex-app-server-agent/scripts/generate-protocol.ts

// Source: AbsolutePathBuf.ts
/**
 * A path that is guaranteed to be absolute and normalized (though it is not
 * guaranteed to be canonicalized or exist on the filesystem).
 *
 * IMPORTANT: When deserializing an `AbsolutePathBuf`, a base path must be set
 * using [AbsolutePathBufGuard::new]. If no base path is set, the
 * deserialization will fail unless the path being deserialized is already
 * absolute.
 */
export type AbsolutePathBuf = string;

// Source: AgentPath.ts
export type AgentPath = string;

// Source: ClientInfo.ts
export type ClientInfo = { name: string, title: string | null, version: string, };

// Source: CollaborationMode.ts
/**
 * Collaboration mode for a Codex session.
 */
export type CollaborationMode = { mode: ModeKind, settings: Settings, };

// Source: FunctionCallOutputBody.ts
export type FunctionCallOutputBody = string | Array<FunctionCallOutputContentItem>;

// Source: FunctionCallOutputContentItem.ts
/**
 * Responses API compatible content items that can be returned by a tool call.
 * This is a subset of ContentItem with the types we support as function call outputs.
 */
export type FunctionCallOutputContentItem = { "type": "input_text", text: string, } | { "type": "input_image", detail?: ImageDetail, } & ({ image_url: string, } | { file_id: string, }) | { "type": "input_audio", audio_url: string, } | { "type": "encrypted_content", encrypted_content: string, };

// Source: ImageDetail.ts
export type ImageDetail = "auto" | "low" | "high" | "original";

// Source: ImageGenerationFailure.ts
export type ImageGenerationFailure = { "type": "usageLimitExceeded", limitId: string, resetsAt: number | null, };

// Source: ImageGenerationItem.ts
export type ImageGenerationItem = { id: string, status: string, revisedPrompt: string | null, result: string, transparentBackground?: boolean, failure: ImageGenerationFailure | null, savedPath?: AbsolutePathBuf, };

// Source: InitializeCapabilities.ts
/**
 * Client-declared capabilities negotiated during initialize.
 */
export type InitializeCapabilities = {
/**
 * Use explicit gateway OAuth login instead of automatic browser authorization.
 * Applies to this app-server's gateway runtime; later connections cannot undo it.
 */
explicitGatewayOauth?: boolean,
/**
 * Opt into receiving experimental API methods and fields.
 */
experimentalApi: boolean,
/**
 * Opt into `attestation/generate` requests for upstream `x-oai-attestation`.
 */
requestAttestation: boolean,
/**
 * Legacy opt-in for the `openai/form` MCP extension.
 *
 * New clients should declare `openai/form` in [`Self::extensions`].
 */
mcpServerOpenaiFormElicitation?: boolean,
/**
 * Exact notification method names that should be suppressed for this
 * connection (for example `thread/started`).
 */
optOutNotificationMethods?: Array<string> | null,
/**
 * MCP extension settings declared by the app-server client.
 */
extensions?: { [key in string]?: JsonValue } | null, };

// Source: InitializeParams.ts
export type InitializeParams = { clientInfo: ClientInfo, capabilities: InitializeCapabilities | null, };

// Source: InitializeResponse.ts
export type InitializeResponse = { userAgent: string,
/**
 * Absolute path to the server's $CODEX_HOME directory.
 */
codexHome: AbsolutePathBuf,
/**
 * Platform family for the running app-server target, for example
 * `"unix"` or `"windows"`.
 */
platformFamily: string,
/**
 * Operating system for the running app-server target, for example
 * `"macos"`, `"linux"`, or `"windows"`.
 */
platformOs: string, };

// Source: InputModality.ts
/**
 * Canonical user-input modality tags advertised by a model.
 */
export type InputModality = "text" | "image" | "audio";

// Source: LegacyAppPathString.ts
/**
 * A UTF-8 path for preserving raw path compatibility at the app-server API
 * boundary while Codex migrates to [`PathUri`].
 *
 * Supports storing arbitrary strings read from the API and converting to and
 * from [`PathUri`] using an explicitly selected native path convention.
 *
 * When converting from [`PathUri`], "native" refers to the supplied
 * [`PathConvention`], which may be foreign to the operating system running
 * this process. The inner string is private so path-producing code must use a
 * path conversion method instead of bypassing the intended conversion
 * boundary. Non-UTF-8 paths are converted to UTF-8 lossily because this API
 * value is serialized as a JSON string.
 *
 * Deserialization and [`Self::from_string`] accept any UTF-8 string without
 * interpreting or validating it. Use [`Self::from_string`] when a caller
 * already owns legacy app-server path text and needs to preserve its wire
 * spelling; use [`Self::from_path`], [`Self::from_abs_path`], or
 * [`Self::from_path_uri`] when converting an actual path value. Relative
 * path text remains valid until an operation such as [`Self::to_path_uri`]
 * requires an absolute path.
 */
export type LegacyAppPathString = string;

// Source: MessagePhase.ts
/**
 * Classifies an assistant message as interim commentary or final answer text.
 *
 * Providers do not emit this consistently, so callers must treat `None` as
 * "phase unknown" and keep compatibility behavior for legacy models.
 */
export type MessagePhase = "commentary" | "final_answer";

// Source: ModeKind.ts
/**
 * Initial collaboration mode to use when the TUI starts.
 */
export type ModeKind = "plan" | "default";

// Source: Personality.ts
/**
 * Deprecated: `friendly` and `pragmatic` no longer select a style.
 */
export type Personality = "none" | "friendly" | "pragmatic";

// Source: ReasoningEffort.ts
/**
 * See https://platform.openai.com/docs/guides/reasoning?api-mode=responses#get-started-with-reasoning
 */
export type ReasoningEffort = string;

// Source: ReasoningSummary.ts
/**
 * A summary of the reasoning performed by the model. This can be useful for
 * debugging and understanding the model's reasoning process.
 * See https://platform.openai.com/docs/guides/reasoning?api-mode=responses#reasoning-summaries
 */
export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";

// Source: serde_json/JsonValue.ts
export type JsonValue = number | string | boolean | Array<JsonValue> | { [key in string]?: JsonValue } | null;

// Source: Settings.ts
/**
 * Settings for a collaboration mode.
 */
export type Settings = { model: string, reasoning_effort: ReasoningEffort | null, developer_instructions: string | null, };

// Source: SleepItem.ts
/**
 * Display item emitted by the interruptible `clock.sleep` tool.
 */
export type SleepItem = { id: string, durationMs: number, };

// Source: SubAgentSource.ts
export type SubAgentSource = "review" | "compact" | { "thread_spawn": { parent_thread_id: ThreadId, depth: number, agent_path: AgentPath | null, agent_nickname: string | null, agent_role: string | null, } } | "memory_consolidation" | { "other": string };

// Source: ThreadId.ts
/**
 * Identifier for a Codex thread.
 *
 * Codex-generated thread IDs are UUIDv7, and some use cases rely on that.
 */
export type ThreadId = string;

// Source: v2/AgentMessageDelivery.ts
export type AgentMessageDelivery = "async";

// Source: v2/AgentMessageDeltaNotification.ts
export type AgentMessageDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, };

// Source: v2/ApprovalsReviewer.ts
/**
 * Configures who approval requests are routed to for review. Examples
 * include sandbox escapes, blocked network access, MCP approval prompts, and
 * ARC escalations. Defaults to `user`. `auto_review` uses a carefully
 * prompted subagent to gather relevant context and apply a risk-based
 * decision framework before approving or denying the request.
 */
export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";

// Source: v2/AskForApproval.ts
export type AskForApproval = "untrusted" | "on-request" | { "granular": { sandbox_approval: boolean, rules: boolean, skill_approval: boolean, request_permissions: boolean, mcp_elicitations: boolean, } } | "never";

// Source: v2/AsyncUserInputQuestion.ts
export type AsyncUserInputQuestion = { title: string, options: Array<string> | null, };

// Source: v2/ByteRange.ts
export type ByteRange = { start: number, end: number, };

// Source: v2/CodexErrorInfo.ts
/**
 * This translation layer make sure that we expose codex error code in camel case.
 *
 * When an upstream HTTP status is available (for example, from the Responses API or a provider),
 * it is forwarded in `httpStatusCode` on the relevant `codexErrorInfo` variant.
 */
export type CodexErrorInfo = "contextWindowExceeded" | "sessionBudgetExceeded" | "usageLimitExceeded" | "rateLimitExceeded" | "flexUnavailable" | "serverOverloaded" | "cyberPolicy" | "misalignmentPolicyViolation" | "tooManyDenials" | { "httpConnectionFailed": { httpStatusCode: number | null, } } | { "responseStreamConnectionFailed": { httpStatusCode: number | null, } } | "internalServerError" | "unauthorized" | "badRequest" | "threadRollbackFailed" | "sandboxError" | { "responseStreamDisconnected": { httpStatusCode: number | null, } } | { "responseTooManyFailedAttempts": { httpStatusCode: number | null, } } | { "activeTurnNotSteerable": { turnKind: NonSteerableTurnKind, } } | "other";

// Source: v2/CollabAgentState.ts
export type CollabAgentState = { status: CollabAgentStatus, message: string | null, };

// Source: v2/CollabAgentStatus.ts
export type CollabAgentStatus = "pendingInit" | "running" | "interrupted" | "completed" | "errored" | "shutdown" | "notFound";

// Source: v2/CollabAgentTool.ts
export type CollabAgentTool = "spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent" | "sendMessage" | "followupTask" | "interruptAgent" | "listAgents";

// Source: v2/CollabAgentToolCallStatus.ts
export type CollabAgentToolCallStatus = "inProgress" | "completed" | "failed" | "interrupted";

// Source: v2/CommandAction.ts
export type CommandAction = { "type": "read", command: string, name: string, path: LegacyAppPathString, } | { "type": "listFiles", command: string, path: string | null, } | { "type": "search", command: string, query: string | null, path: string | null, } | { "type": "unknown", command: string, };

// Source: v2/CommandExecutionOutputDeltaNotification.ts
export type CommandExecutionOutputDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, };

// Source: v2/CommandExecutionSource.ts
export type CommandExecutionSource = "agent" | "userShell" | "unifiedExecStartup" | "unifiedExecInteraction";

// Source: v2/CommandExecutionStatus.ts
export type CommandExecutionStatus = "inProgress" | "completed" | "failed" | "declined";

// Source: v2/CyberAccessProgram.ts
/**
 * Requested cyber treatment for a ChatGPT-authenticated Codex turn.
 * Authorization and model-tier restrictions remain server-owned.
 */
export type CyberAccessProgram = "standard" | "daybreakBlue" | "daybreakRed";

// Source: v2/DynamicToolCallOutputContentItem.ts
export type DynamicToolCallOutputContentItem = { "type": "inputText", text: string, } | { "type": "inputImage", imageUrl: string, } | { "type": "inputAudio", audioUrl: string, };

// Source: v2/DynamicToolCallStatus.ts
export type DynamicToolCallStatus = "inProgress" | "completed" | "failed";

// Source: v2/ErrorNotification.ts
export type ErrorNotification = { error: TurnError, willRetry: boolean, threadId: string, turnId: string, };

// Source: v2/FileUpdateChange.ts
export type FileUpdateChange = { path: string, kind: PatchChangeKind, diff: string, };

// Source: v2/GitInfo.ts
export type GitInfo = { sha: string | null, branch: string | null, originUrl: string | null, };

// Source: v2/HookPromptFragment.ts
export type HookPromptFragment = { text: string, hookRunId: string, };

// Source: v2/ItemCompletedNotification.ts
export type ItemCompletedNotification = { item: ThreadItem, threadId: string, turnId: string,
/**
 * Unix timestamp (in milliseconds) when this item lifecycle completed.
 */
completedAtMs: number, };

// Source: v2/ItemStartedNotification.ts
export type ItemStartedNotification = { item: ThreadItem, threadId: string, turnId: string,
/**
 * Unix timestamp (in milliseconds) when this item lifecycle started.
 */
startedAtMs: number, };

// Source: v2/McpAppDisplayMode.ts
export type McpAppDisplayMode = "inline" | "fullscreen";

// Source: v2/McpAppUi.ts
/**
 * UI resource and display preference for model invocations, captured from the tool descriptor.
 */
export type McpAppUi = { resourceUri: string, preferredModelDisplayMode: McpAppDisplayMode, };

// Source: v2/McpToolCallAppContext.ts
export type McpToolCallAppContext = { connectorId: string, linkId: string | null, resourceUri: string | null, appName: string | null, actionName: string | null, };

// Source: v2/McpToolCallError.ts
export type McpToolCallError = { message: string, };

// Source: v2/McpToolCallResult.ts
export type McpToolCallResult = { content: Array<JsonValue>, structuredContent: JsonValue | null, _meta: JsonValue | null, };

// Source: v2/McpToolCallStatus.ts
export type McpToolCallStatus = "inProgress" | "completed" | "failed";

// Source: v2/MemoryCitation.ts
export type MemoryCitation = { entries: Array<MemoryCitationEntry>, threadIds: Array<string>, };

// Source: v2/MemoryCitationEntry.ts
export type MemoryCitationEntry = { path: string, lineStart: number, lineEnd: number, note: string, };

// Source: v2/MisalignmentErrorDetails.ts
export type MisalignmentErrorDetails = {
/**
 * Open-ended classification; clients must accept categories added by Responses.
 */
errorType: string | null,
/**
 * A substantive localized explanation is required before offering continuation.
 */
detailedExplanation: string | null,
/**
 * Instruction to submit as the next turn's user input if continuation is confirmed.
 */
steer: MisalignmentSteer | null, };

// Source: v2/MisalignmentSteer.ts
export type MisalignmentSteer = { message: string, };

// Source: v2/Model.ts
export type Model = { id: string, model: string, upgrade: string | null, upgradeInfo: ModelUpgradeInfo | null, availabilityNux: ModelAvailabilityNux | null, displayName: string, description: string, modelSpecialty: string | null, hidden: boolean, supportedReasoningEfforts: Array<ReasoningEffortOption>, defaultReasoningEffort: ReasoningEffort, inputModalities: Array<InputModality>,
/**
 * @deprecated Always false; models no longer support personality selection.
 */
supportsPersonality: boolean,
/**
 * Multi-agent runtime declared by this model, when available.
 */
multiAgentVersion: MultiAgentVersion | null,
/**
 * Deprecated: use `serviceTiers` instead.
 */
additionalSpeedTiers: Array<string>, serviceTiers: Array<ModelServiceTier>,
/**
 * Catalog default service tier id for this model, when one is configured.
 */
defaultServiceTier: string | null,
/**
 * Null when the catalog does not provide access-program metadata.
 */
availableAccessPrograms: ModelAccessPrograms | null, isDefault: boolean, };

// Source: v2/ModelAccessPrograms.ts
/**
 * Caller-specific explicit access programs advertised by model discovery.
 */
export type ModelAccessPrograms = {
/**
 * Accepted explicit selections.
 */
cyber: Array<CyberAccessProgram>, };

// Source: v2/ModelAvailabilityNux.ts
export type ModelAvailabilityNux = { message: string, };

// Source: v2/ModelListParams.ts
export type ModelListParams = {
/**
 * Opaque pagination cursor returned by a previous call.
 */
cursor?: string | null,
/**
 * Optional page size; defaults to a reasonable server-side value.
 */
limit?: number | null,
/**
 * When true, include models that are hidden from the default picker list.
 */
includeHidden?: boolean | null, };

// Source: v2/ModelListResponse.ts
export type ModelListResponse = { data: Array<Model>,
/**
 * Opaque cursor to pass to the next call to continue after the last item.
 * If None, there are no more items to return.
 */
nextCursor: string | null, };

// Source: v2/ModelServiceTier.ts
export type ModelServiceTier = { id: string, name: string, description: string, };

// Source: v2/ModelUpgradeInfo.ts
export type ModelUpgradeInfo = { model: string, upgradeCopy: string | null, modelLink: string | null, migrationMarkdown: string | null,
/**
 * Informational Unix timestamp for this upgrade's scheduled retirement, if known.
 */
retirementAt: number | null, };

// Source: v2/MultiAgentVersion.ts
/**
 * Multi-agent runtime supported by a model.
 */
export type MultiAgentVersion = "disabled" | "v1" | "v2";

// Source: v2/NetworkAccess.ts
export type NetworkAccess = "restricted" | "enabled";

// Source: v2/NonSteerableTurnKind.ts
export type NonSteerableTurnKind = "review" | "compact";

// Source: v2/PatchApplyStatus.ts
export type PatchApplyStatus = "inProgress" | "completed" | "failed" | "declined";

// Source: v2/PatchChangeKind.ts
export type PatchChangeKind = { "type": "add" } | { "type": "delete" } | { "type": "update", move_path: string | null, };

// Source: v2/PlanDeltaNotification.ts
/**
 * EXPERIMENTAL - proposed plan streaming deltas for plan items. Clients should
 * not assume concatenated deltas match the completed plan item content.
 */
export type PlanDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, };

// Source: v2/ReasoningEffortOption.ts
export type ReasoningEffortOption = { reasoningEffort: ReasoningEffort, description: string, };

// Source: v2/ReasoningSummaryTextDeltaNotification.ts
export type ReasoningSummaryTextDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, summaryIndex: number, };

// Source: v2/SandboxMode.ts
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

// Source: v2/SandboxPolicy.ts
export type SandboxPolicy = { "type": "dangerFullAccess" } | { "type": "readOnly", networkAccess: boolean, } | { "type": "externalSandbox", networkAccess: NetworkAccess, } | { "type": "workspaceWrite", writableRoots: Array<AbsolutePathBuf>, networkAccess: boolean, excludeTmpdirEnvVar: boolean, excludeSlashTmp: boolean, };

// Source: v2/SessionSource.ts
export type SessionSource = "cli" | "vscode" | "exec" | "appServer" | { "custom": string } | { "subAgent": SubAgentSource } | "unknown";

// Source: v2/SubAgentActivityKind.ts
export type SubAgentActivityKind = "started" | "interacted" | "interrupted" | "completed";

// Source: v2/TextElement.ts
export type TextElement = {
/**
 * Byte range in the parent `text` buffer that this element occupies.
 */
byteRange: ByteRange,
/**
 * Optional human-readable placeholder for the element, displayed in the UI.
 */
placeholder: string | null, };

// Source: v2/Thread.ts
export type Thread = {/**
 * Identifier for this thread. Codex-generated thread IDs are UUIDv7.
 */
id: string, /**
 * Session id shared by threads that belong to the same session tree.
 */
sessionId: string, /**
 * Source thread id when this thread was created by forking another thread.
 */
forkedFromId: string | null, /**
 * The ID of the parent thread. This will only be set if this thread is a subagent.
 */
parentThreadId: string | null, /**
 * Usually the first user message in the thread, if available.
 */
preview: string, /**
 * Whether the thread is ephemeral and should not be materialized on disk.
 */
ephemeral: boolean, /**
 * The independently persisted section selected for this thread, if any.
 */
section: ThreadSection | null, /**
 * Unix timestamp in seconds when the thread entered its current section.
 */
sectionEnteredAt: number | null, /**
 * Canonical project assignment owned by app-server, if any.
 */
projectId: string | null, /**
 * Persisted thread history contract selected when this thread was created.
 */
historyMode: ThreadHistoryMode, /**
 * Model provider used for this thread (for example, 'openai').
 */
modelProvider: string, /**
 * Current configured model when loaded, otherwise the latest persisted model.
 * Null when unavailable. This is not per-turn execution telemetry.
 */
model: string | null, /**
 * Current configured reasoning effort when loaded, otherwise the latest persisted effort.
 * Null when unset or unavailable. This is not per-turn execution telemetry.
 */
reasoningEffort: ReasoningEffort | null, /**
 * Unix timestamp (in seconds) when the thread was created.
 */
createdAt: number, /**
 * Unix timestamp (in seconds) when the thread was last updated.
 */
updatedAt: number, /**
 * Unix timestamp (in seconds) used for thread recency ordering.
 */
recencyAt: number | null, /**
 * Current runtime status for the thread.
 */
status: ThreadStatus, /**
 * [UNSTABLE] Path to the thread on disk.
 */
path: string | null, /**
 * Working directory captured for the thread.
 */
cwd: AbsolutePathBuf, /**
 * Version of the CLI that created the thread.
 */
cliVersion: string, /**
 * Originator recorded when the thread was created, independent of its current client or executor.
 * Null when the recorded originator is unavailable.
 */
originator: string | null, /**
 * Origin of the thread (CLI, VSCode, codex exec, codex app-server, etc.).
 */
source: SessionSource, /**
 * Optional analytics source classification for this thread.
 */
threadSource: ThreadSource | null, /**
 * Optional random unique nickname assigned to an AgentControl-spawned sub-agent.
 */
agentNickname: string | null, /**
 * Optional role (agent_role) assigned to an AgentControl-spawned sub-agent.
 */
agentRole: string | null, /**
 * Optional Git metadata captured when the thread was created.
 */
gitInfo: GitInfo | null, /**
 * Optional user-facing thread title.
 */
name: string | null, /**
 * Only populated on `thread/resume`, `thread/fork`, and `thread/read`
 * (when `includeTurns` is true) responses.
 * For all other responses and notifications returning a Thread,
 * the turns field will be an empty list.
 */
turns: Array<Turn>};

// Source: v2/ThreadActiveFlag.ts
export type ThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";

// Source: v2/ThreadHistoryMode.ts
export type ThreadHistoryMode = "legacy" | "paginated";

// Source: v2/ThreadItem.ts
export type ThreadItem = { "type": "userMessage", id: string, clientId: string | null, content: Array<UserInput>, } | { "type": "hookPrompt", id: string, fragments: Array<HookPromptFragment>, } | { "type": "agentMessage", id: string, text: string, phase: MessagePhase | null, memoryCitation: MemoryCitation | null, delivery: AgentMessageDelivery | null, questions: Array<AsyncUserInputQuestion> | null, } | { "type": "functionCallOutput", id: string, name: string, namespace: string | null, output: FunctionCallOutputBody, } | { "type": "plan", id: string, text: string, } | { "type": "reasoning", id: string, summary: Array<string>, content: Array<string>, } | { "type": "commandExecution", id: string,
/**
 * Trusted first-party plugin id when this command resolves to one plugin script.
 */
pluginId: string | null,
/**
 * Safe plugin-relative path when this command resolves to one plugin script.
 */
scriptPath: string | null,
/**
 * The command to be executed.
 */
command: string,
/**
 * The command's working directory.
 */
cwd: LegacyAppPathString,
/**
 * Identifier for the underlying PTY process (when available).
 */
processId: string | null, source: CommandExecutionSource, status: CommandExecutionStatus,
/**
 * A best-effort parsing of the command to understand the action(s) it will perform.
 * This returns a list of CommandAction objects because a single shell command may
 * be composed of many commands piped together.
 */
commandActions: Array<CommandAction>,
/**
 * The command's output, aggregated from stdout and stderr.
 */
aggregatedOutput: string | null,
/**
 * The command's exit code.
 */
exitCode: number | null,
/**
 * The duration of the command execution in milliseconds.
 */
durationMs: number | null, } | { "type": "fileChange", id: string, changes: Array<FileUpdateChange>, status: PatchApplyStatus, } | { "type": "mcpToolCall", id: string, server: string, tool: string, status: McpToolCallStatus, arguments: JsonValue, appContext: McpToolCallAppContext | null,
/**
 * Legacy compatibility field; prefer `mcpAppUi.resourceUri` when available.
 */
mcpAppResourceUri?: string,
/**
 * Presentation captured from the invoked descriptor; absent in older history.
 */
mcpAppUi: McpAppUi | null, pluginId: string | null, readOnlyHint: boolean | null, result: McpToolCallResult | null, error: McpToolCallError | null,
/**
 * The duration of the MCP tool call in milliseconds.
 */
durationMs: number | null, } | { "type": "dynamicToolCall", id: string, namespace: string | null, tool: string, arguments: JsonValue, status: DynamicToolCallStatus, contentItems: Array<DynamicToolCallOutputContentItem> | null, success: boolean | null,
/**
 * The duration of the dynamic tool call in milliseconds.
 */
durationMs: number | null, } | { "type": "collabAgentToolCall",
/**
 * Unique identifier for this collab tool call.
 */
id: string,
/**
 * Name of the collab tool that was invoked.
 */
tool: CollabAgentTool,
/**
 * Current status of the collab tool call.
 */
status: CollabAgentToolCallStatus,
/**
 * Thread ID of the agent issuing the collab request.
 */
senderThreadId: string,
/**
 * Thread ID of the receiving agent, when applicable. In case of spawn operation,
 * this corresponds to the newly spawned agent.
 */
receiverThreadIds: Array<string>,
/**
 * Prompt text sent as part of the collab tool call, when available.
 */
prompt: string | null,
/**
 * Model requested for the spawned agent, when applicable.
 */
model: string | null,
/**
 * Reasoning effort requested for the spawned agent, when applicable.
 */
reasoningEffort: ReasoningEffort | null,
/**
 * Last known status of the target agents, when available.
 */
agentsStates: { [key in string]?: CollabAgentState }, } | { "type": "subAgentActivity", id: string, kind: SubAgentActivityKind, agentThreadId: string, agentPath: string, } | { "type": "webSearch" } & WebSearchItem | { "type": "imageView", id: string, path: LegacyAppPathString, } | { "type": "sleep" } & SleepItem | { "type": "imageGeneration" } & ImageGenerationItem | { "type": "enteredReviewMode", id: string, review: string, } | { "type": "exitedReviewMode", id: string, review: string, } | { "type": "contextCompaction", id: string, };

// Source: v2/ThreadReadParams.ts
export type ThreadReadParams = { threadId: string,
/**
 * When true, include turns and their items from rollout history.
 * Full-history hydration is deprecated for paginated threads; prefer a
 * metadata-only read and page with `thread/turns/list` and
 * `thread/items/list`.
 */
includeTurns?: boolean, };

// Source: v2/ThreadReadResponse.ts
export type ThreadReadResponse = { thread: Thread, };

// Source: v2/ThreadResumeParams.ts
/**
 * There are three ways to resume a thread:
 * 1. By thread_id: load the thread from disk by thread_id and resume it.
 * 2. By history: instantiate the thread from memory and resume it.
 * 3. By path: load the thread from disk by path and resume it.
 *
 * For non-running threads, the precedence is: history > non-empty path > thread_id.
 * If using history or a non-empty path for a non-running thread, the thread_id
 * param will be ignored.
 *
 * If thread_id identifies a running thread, app-server rejoins that thread and
 * treats a non-empty path as a consistency check against the active rollout path.
 * Empty string path values are treated as absent.
 *
 * Prefer using thread_id whenever possible.
 */
export type ThreadResumeParams = {threadId: string, /**
 * Configuration overrides for the resumed thread, if any.
 */
model?: string | null, modelProvider?: string | null, serviceTier?: string | null | null, cwd?: string | null, approvalPolicy?: AskForApproval | null, /**
 * Override where approval requests are routed for review on this thread
 * and subsequent turns.
 */
approvalsReviewer?: ApprovalsReviewer | null, sandbox?: SandboxMode | null, config?: { [key in string]?: JsonValue } | null, baseInstructions?: string | null, developerInstructions?: string | null, /**
 * @deprecated `friendly` and `pragmatic` no longer select a style.
 * Changing this does not rewrite the thread's existing instructions.
 */
personality?: Personality | null, /**
 * When true, return only thread metadata and live-resume state without
 * populating `thread.turns`. This is useful when the client plans to call
 * `thread/turns/list` immediately after resuming. Full-history hydration
 * is deprecated for paginated threads; use this with `thread/turns/list`
 * and `thread/items/list` instead.
 */
excludeTurns?: boolean};

// Source: v2/ThreadResumeResponse.ts
export type ThreadResumeResponse = {thread: Thread, model: string, modelProvider: string, serviceTier: string | null, /**
 * Saved list of disabled plugin IDs. Does not yet filter plugin capabilities.
 */
disabledPluginIds: Array<string>, cwd: AbsolutePathBuf, /**
 * Environment-native paths to instruction source files currently loaded for this thread.
 */
instructionSources: Array<LegacyAppPathString>, approvalPolicy: AskForApproval, /**
 * Reviewer currently used for approval requests on this thread.
 */
approvalsReviewer: ApprovalsReviewer, /**
 * Legacy sandbox policy retained for compatibility. Experimental clients
 * should prefer `activePermissionProfile` for profile provenance.
 */
sandbox: SandboxPolicy, reasoningEffort: ReasoningEffort | null, /**
 * Effective collaboration mode. Absent when resuming from an older server.
 */
collaborationMode: CollaborationMode | null, /**
 * Opaque cursor for hydrating paginated turns backwards.
 *
 * Pass this as `cursor` to `thread/turns/list` with
 * `sortDirection: "desc"`. The first page includes the turn identified by the cursor.
 */
turnsBackwardsCursor: string | null, /**
 * Opaque cursor for hydrating paginated items backwards.
 *
 * Pass this as `cursor` to `thread/items/list` with
 * `sortDirection: "desc"`. The first page includes the item identified by the cursor.
 */
itemsBackwardsCursor: string | null};

// Source: v2/ThreadSection.ts
/**
 * An independently persisted, user-visible thread section.
 */
export type ThreadSection = {
/**
 * Opaque UUIDv7 identity that remains stable when the section is renamed.
 */
id: string,
/**
 * The current user-visible section name.
 */
name: string,
/**
 * Optional appearance synchronized across clients.
 */
appearance: ThreadSectionAppearance | null, };

// Source: v2/ThreadSectionAppearance.ts
/**
 * Extensible visual presentation for a custom thread section.
 */
export type ThreadSectionAppearance = { icon: string | null, color: string | null, };

// Source: v2/ThreadSource.ts
export type ThreadSource = string;

// Source: v2/ThreadStartParams.ts
export type ThreadStartParams = {model?: string | null, modelProvider?: string | null, serviceTier?: string | null | null, cwd?: string | null, approvalPolicy?: AskForApproval | null, /**
 * Override where approval requests are routed for review on this thread
 * and subsequent turns.
 */
approvalsReviewer?: ApprovalsReviewer | null, sandbox?: SandboxMode | null, config?: { [key in string]?: JsonValue } | null, serviceName?: string | null, baseInstructions?: string | null, developerInstructions?: string | null, /**
 * @deprecated `friendly` and `pragmatic` no longer select a style.
 */
personality?: Personality | null, ephemeral?: boolean | null, sessionStartSource?: ThreadStartSource | null, /**
 * Optional client-supplied analytics source classification for this thread.
 */
threadSource?: ThreadSource | null};

// Source: v2/ThreadStartResponse.ts
export type ThreadStartResponse = {thread: Thread, model: string, modelProvider: string, serviceTier: string | null, /**
 * Saved list of disabled plugin IDs. Does not yet filter plugin capabilities.
 */
disabledPluginIds: Array<string>, cwd: AbsolutePathBuf, /**
 * Environment-native paths to instruction source files currently loaded for this thread.
 */
instructionSources: Array<LegacyAppPathString>, approvalPolicy: AskForApproval, /**
 * Reviewer currently used for approval requests on this thread.
 */
approvalsReviewer: ApprovalsReviewer, /**
 * Legacy sandbox policy retained for compatibility. Experimental clients
 * should prefer `activePermissionProfile` for profile provenance.
 */
sandbox: SandboxPolicy, reasoningEffort: ReasoningEffort | null};

// Source: v2/ThreadStartSource.ts
export type ThreadStartSource = "startup" | "clear";

// Source: v2/ThreadStatus.ts
export type ThreadStatus = { "type": "notLoaded" } | { "type": "idle" } | { "type": "systemError" } | { "type": "active", activeFlags: Array<ThreadActiveFlag>, };

// Source: v2/ThreadTokenUsage.ts
export type ThreadTokenUsage = { total: TokenUsageBreakdown, last: TokenUsageBreakdown, modelContextWindow: number | null, };

// Source: v2/ThreadTokenUsageUpdatedNotification.ts
export type ThreadTokenUsageUpdatedNotification = { threadId: string, turnId: string, tokenUsage: ThreadTokenUsage, };

// Source: v2/TokenUsageBreakdown.ts
export type TokenUsageBreakdown = { totalTokens: number, inputTokens: number, cachedInputTokens: number, cacheWriteInputTokens: number, outputTokens: number, reasoningOutputTokens: number, };

// Source: v2/Turn.ts
export type Turn = {
/**
 * Identifier for this turn. Codex-generated turn IDs are UUIDv7.
 */
id: string,
/**
 * Thread items currently included in this turn payload.
 */
items: Array<ThreadItem>,
/**
 * Describes how much of `items` has been loaded for this turn.
 */
itemsView: TurnItemsView, status: TurnStatus,
/**
 * Error associated with a failed or interrupted turn.
 */
error: TurnError | null,
/**
 * Unix timestamp (in seconds) when the turn started.
 */
startedAt: number | null,
/**
 * Unix timestamp (in seconds) when the turn completed.
 */
completedAt: number | null,
/**
 * Duration between turn start and completion in milliseconds, if known.
 */
durationMs: number | null, };

// Source: v2/TurnCompletedNotification.ts
export type TurnCompletedNotification = { threadId: string, turn: Turn, };

// Source: v2/TurnError.ts
export type TurnError = { message: string, codexErrorInfo: CodexErrorInfo | null, additionalDetails: string | null,
/**
 * Optional public explanation and continuation instruction for a misalignment block.
 */
misalignment: MisalignmentErrorDetails | null, };

// Source: v2/TurnInterruptParams.ts
export type TurnInterruptParams = { threadId: string, turnId: string, };

// Source: v2/TurnInterruptResponse.ts
export type TurnInterruptResponse = Record<string, never>;

// Source: v2/TurnItemsView.ts
export type TurnItemsView = "notLoaded" | "summary" | "full";

// Source: v2/TurnStartedNotification.ts
export type TurnStartedNotification = { threadId: string, turn: Turn, };

// Source: v2/TurnStartParams.ts
export type TurnStartParams = {threadId: string, /**
 * Replace this thread's disabled plugin IDs.
 * Omitted/null preserves the list; [] clears it.
 */
disabledPluginIds?: Array<string> | null, clientUserMessageId?: string | null, input: Array<UserInput>, /**
 * Optional source classification for the caller that starts this turn.
 * Ignored when this request steers an already-active turn.
 */
turnTrigger?: string | null, toolOutput?: TurnToolOutput | null, /**
 * Override the working directory for this turn and subsequent turns.
 */
cwd?: string | null, /**
 * Override the approval policy for this turn and subsequent turns.
 */
approvalPolicy?: AskForApproval | null, /**
 * Override where approval requests are routed for review on this turn and
 * subsequent turns.
 */
approvalsReviewer?: ApprovalsReviewer | null, /**
 * Override the sandbox policy for this turn and subsequent turns.
 */
sandboxPolicy?: SandboxPolicy | null, /**
 * Override the model for this turn and subsequent turns.
 */
model?: string | null, /**
 * Override the service tier for this turn and subsequent turns.
 */
serviceTier?: string | null | null, /**
 * Override the service tier only when this request starts a new turn.
 * Use "default" for standard speed. Omitted or null inherits the thread's tier.
 * Does not change the thread's tier or a turn being steered.
 */
serviceTierForTurn?: string | null, /**
 * Override the reasoning effort for this turn and subsequent turns.
 */
effort?: ReasoningEffort | null, /**
 * Override the reasoning summary for this turn and subsequent turns.
 */
summary?: ReasoningSummary | null, /**
 * @deprecated `friendly` and `pragmatic` no longer select a style.
 * Changing this does not rewrite the thread's existing instructions.
 */
personality?: Personality | null, /**
 * Optional JSON Schema used to constrain the final assistant message for
 * this turn.
 */
outputSchema?: JsonValue | null};

// Source: v2/TurnStartResponse.ts
export type TurnStartResponse = { turn: Turn, };

// Source: v2/TurnStatus.ts
export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

// Source: v2/TurnSteerParams.ts
export type TurnSteerParams = {threadId: string, clientUserMessageId?: string | null, input: Array<UserInput>, /**
 * Required active turn id precondition. The request fails when it does not
 * match the currently active turn.
 */
expectedTurnId: string};

// Source: v2/TurnSteerResponse.ts
export type TurnSteerResponse = { turnId: string, };

// Source: v2/TurnToolOutput.ts
export type TurnToolOutput = { name: string, namespace: string | null, output: FunctionCallOutputBody, };

// Source: v2/UserInput.ts
export type UserInput = { "type": "text", text: string,
/**
 * UI-defined spans within `text` used to render or persist special elements.
 */
text_elements: Array<TextElement>, } | { "type": "image", detail?: ImageDetail, } & ({ url: string, } | { fileId: string, }) | { "type": "localImage", detail?: ImageDetail, path: string, } | { "type": "audio", url: string, } | { "type": "localAudio", path: string, } | { "type": "skill", name: string, path: string, } | { "type": "mention", name: string, path: string, };

// Source: v2/WebSearchAction.ts
export type WebSearchAction = { "type": "search", query: string | null, queries: Array<string> | null, } | { "type": "openPage", url: string | null, } | { "type": "findInPage", url: string | null, pattern: string | null, } | { "type": "other" };

// Source: WebSearchItem.ts
export type WebSearchItem = { id: string, query: string, action: WebSearchAction | null,
/**
 * Structured search results returned out-of-band by standalone web search.
 *
 * These stay as opaque JSON at the extension/app-server boundary so new
 * result fields and result types can pass through without a Codex release.
 */
results: Array<JsonValue> | null, };
