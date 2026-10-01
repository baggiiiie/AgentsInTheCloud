import { createRegistry, defineExtension, type AgentChange, type Extension, type HarnessOptions } from "@earendil-works/pi-durable";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { createPiModelRuntime } from "@atelier/llm/server";
import { workspaceRoot } from "@atelier/workspace";
import { createDurableWorkspaceTools } from "./durable-tools.ts";
import { createDurableBashExtension } from "./durable-bash.ts";
import { createRegisteredDurableOnboardingExtensions } from "./durable-onboarding.ts";
import { loadWorkspaceAgentsFiles } from "./workspace-agents-files.ts";
import { loadWorkspaceSkills } from "./skills.ts";
import { atelierSystemPrompt, prepareAppendedAtelierInstructions } from "./system-prompt.ts";
import { resolveNewWorkspaceAgentModel } from "./model-state.ts";
import { compactionKeepRecentTokens } from "./runtime-status.ts";
import type { WorkspaceAgentToolOptions } from "./tools.ts";

/** Workspace-scoped code, including the task definitions needed to recover bash. */
export function createDurableWorkspaceRegistry(workspaceId: string, options: WorkspaceAgentToolOptions = {}, onboarding: readonly Extension[] = createRegisteredDurableOnboardingExtensions(workspaceId)) {
  const registry = createRegistry();
  registry.install(defineExtension({ name: "atelier.workspace-tools", tools: createDurableWorkspaceTools(workspaceId, options) }));
  registry.install(createDurableBashExtension(workspaceId));
  for (const extension of onboarding) registry.install(extension);
  return registry;
}

/** No AgentSession, delegation coordinator, or host-local filesystem environment. */
export async function createDurableHarnessOptions(workspaceId: string, options: WorkspaceAgentToolOptions = {}): Promise<HarnessOptions> {
  return {
    models: await createPiModelRuntime(),
    registry: createDurableWorkspaceRegistry(workspaceId, options),
    settings: { compaction: { enabled: true, keepRecentTokens: compactionKeepRecentTokens } },
  };
}

const resourceLoaders = {
  agents: loadWorkspaceAgentsFiles,
  skills: loadWorkspaceSkills,
  model: resolveNewWorkspaceAgentModel,
};

/**
 * Prepare outside the journal commit; pass the result to workspace.conversation().
 * The resulting prompt/model are committed with creation, not rebuilt on recovery
 * from potentially changed workspace files or the host's current model default.
 * Existing conversations keep their settings; explicit refresh uses configure().
 */
export async function prepareDurableConversation(
  workspaceId: string,
  conversationId: string,
  options: WorkspaceAgentToolOptions = {},
  initial: Pick<AgentChange, "model" | "thinkingLevel"> = {},
  load: typeof resourceLoaders = resourceLoaders,
): Promise<AgentChange> {
  const [agents, skills, model, appended] = await Promise.all([
    load.agents(workspaceId),
    load.skills(workspaceId),
    initial.model !== undefined ? Promise.resolve(undefined) : load.model(),
    prepareAppendedAtelierInstructions(options.events, workspaceId, conversationId),
  ]);
  const instructions = [
    atelierSystemPrompt,
    ...appended,
    ...agents.map((file) => `# Project instructions: ${file.path}\n\n${file.content}`),
    formatSkillsForPrompt(skills.skills),
    `Current working directory: ${workspaceRoot}`,
  ].filter(Boolean).join("\n\n");
  return {
    cwd: workspaceRoot,
    model: initial.model !== undefined ? initial.model : model ? { provider: model.provider, modelId: model.id } : undefined,
    thinkingLevel: initial.thinkingLevel,
    instructions,
  };
}
