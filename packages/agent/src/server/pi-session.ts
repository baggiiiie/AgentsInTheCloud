import { loadWorkspaceAgentsFiles } from "./workspace-agents-files.ts";
import { agentDelegation, type AgentSessionAttachment, type AgentDelegationTranscript } from "./delegation.ts";
import { observeProviderLimits, type ProviderLimit } from "./provider-limits.ts";
import { observeCacheWarmingDecisions, type CacheWarmingDecisionOutcome } from "./cache-warming-decisions.ts";
import { observeExtensionStatusEvents, type ExtensionStatusEvent } from "./extension-status-events.ts";
import { attachModelRequestPipeline } from "./model-request-pipeline.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { workspaceRoot } from "@atelier/workspace";
import { createAgentSession, SessionManager, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { resolveNewWorkspaceAgentModel } from "./model-state.ts";
import { createPiModelRuntime } from "@atelier/llm/server";
import type { WorkspaceAgentRuntimeOptions } from "./runtime-types.ts";
import { compactionKeepRecentTokens } from "./runtime-status.ts";
import { AgentServiceTierState, modelRuntimeWithServiceTiers, supportsFastMode, type AgentServiceTier } from "./service-tier.ts";
import type { WorkspaceAgentConversationInfo } from "./session-store.ts";
import { loadWorkspaceSkills } from "./skills.ts";
import { createAtelierResourceLoader, prepareAppendedAtelierInstructions } from "./system-prompt.ts";
import { createWorkspaceAgentTools } from "./tools.ts";
import { createRegisteredOnboardingTools } from "./onboarding-tools.ts";
import type { AgentToolDefinitionView } from "./render-transcript.ts";

export interface AgentSessionDelegation {
  subscribeProviderLimits?: (listener: (limit: ProviderLimit | undefined) => void) => () => void;
  subscribeCacheWarmingDecisions?: (listener: (outcome: CacheWarmingDecisionOutcome) => void) => () => void;
  subscribeExtensionStatusEvents?: (listener: (event: ExtensionStatusEvent) => void) => () => void;
  attachment?: AgentSessionAttachment;
  transcript?: AgentDelegationTranscript;
  dispose(): Promise<void>;
}

interface InitialSessionSettings {
  model?: NonNullable<Parameters<typeof createAgentSession>[0]>["model"];
  thinkingLevel?: NonNullable<Parameters<typeof createAgentSession>[0]>["thinkingLevel"];
  serviceTier?: AgentServiceTier;
}

const bootstrapOnlySessionEntryTypes = new Set(["model_change", "thinking_level_change"]);
const sessionEntryTypeSchema = Type.Object({ type: Type.String() });

export async function discardBootstrapOnlySession(path: string): Promise<void> {
  const content = await readFile(path, "utf8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return;
  const entries = lines.map((line) => Value.Parse(sessionEntryTypeSchema, JSON.parse(line)));
  if (entries.every((entry) => bootstrapOnlySessionEntryTypes.has(entry.type))) await writeFile(path, "");
}

export async function createPiSession(agent: WorkspaceAgentConversationInfo, options: WorkspaceAgentRuntimeOptions, initial: InitialSessionSettings = {}): Promise<{ session: any; toolViews: AgentToolDefinitionView[]; serviceTiers: AgentServiceTierState; delegation: AgentSessionDelegation }> {
  await ensureSessionFile(agent.path);
  await discardBootstrapOnlySession(agent.path);
  const [modelRuntime, defaultModel] = await Promise.all([
    createPiModelRuntime(),
    resolveNewWorkspaceAgentModel(),
  ]);
  const [agentsFiles, skillResources] = await Promise.all([
    loadWorkspaceAgentsFiles(agent.workspaceId),
    loadWorkspaceSkills(agent.workspaceId),
  ]);
  const preparation = await agentDelegation?.prepare({ agent, events: options.events });
  const appendSystemPrompt = await prepareAppendedAtelierInstructions(options.events, agent.workspaceId, agent.conversationId, preparation?.prompt);
  const sessionSettings = { compaction: { enabled: true, keepRecentTokens: compactionKeepRecentTokens } };
  if (defaultModel) Object.assign(sessionSettings, { defaultProvider: defaultModel.provider, defaultModel: defaultModel.id });
  const sessionManager = SessionManager.open(agent.path, dirname(agent.path), workspaceRoot);
  preparation?.seedHistory?.(sessionManager);
  const serviceTiers = new AgentServiceTierState(sessionManager);
  const customTools = [
    ...createWorkspaceAgentTools(agent.workspaceId, { events: options.events }),
    ...(preparation?.tools ?? []),
    ...createRegisteredOnboardingTools(agent.workspaceId, agent.conversationId),
  ];
  const inheritedModel = preparation?.model;
  let promptSession: AgentSession | undefined;
  const { session } = await createAgentSession({
    cwd: workspaceRoot,
    agentDir: dirname(agent.path),
    modelRuntime: modelRuntimeWithServiceTiers(modelRuntime, serviceTiers),
    model: initial.model ?? (inheritedModel ? modelRuntime.getModel(inheritedModel.provider, inheritedModel.id) : undefined),
    thinkingLevel: initial.thinkingLevel ?? preparation?.thinkingLevel,
    resourceLoader: createAtelierResourceLoader(agentsFiles, () => [
      ...appendSystemPrompt,
      ...(promptSession ? preparation?.modelPrompt?.(promptSession.model?.id, promptSession.thinkingLevel) ?? [] : []),
    ], skillResources),
    customTools,
    tools: customTools.map((tool) => tool.name),
    sessionManager,
    settingsManager: SettingsManager.inMemory(sessionSettings),
  });
  promptSession = session;
  let attachment: AgentSessionAttachment | undefined;
  let detachPipeline: (() => void) | undefined;
  const disposeDelegation = async () => {
    detachPipeline?.();
    const owned = attachment;
    attachment = undefined;
    await owned?.dispose();
  };
  try {
    const provider = session.model?.provider;
    if (provider && initial.serviceTier && supportsFastMode(provider)) await serviceTiers.set(provider, initial.serviceTier);
    attachment = preparation?.attach?.(session);
    const createRequest = attachment?.createModelRequest?.bind(attachment);
    if (createRequest) detachPipeline = attachModelRequestPipeline(session, createRequest);
    return {
      session,
      serviceTiers,
      delegation: {
        subscribeProviderLimits: listener => observeProviderLimits(session, listener),
        subscribeCacheWarmingDecisions: listener => observeCacheWarmingDecisions(session, listener),
        subscribeExtensionStatusEvents: listener => observeExtensionStatusEvents(session, listener),
        attachment,
        transcript: preparation?.transcript?.(session),
        dispose: disposeDelegation,
      },
      toolViews: customTools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters, output_schema: preparation?.outputSchemas?.get(tool.name) })),
    };
  } catch (error) {
    try { await session.abort(); } finally { await disposeDelegation(); }
    throw error;
  }
}

async function ensureSessionFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", { flag: "a" });
}
