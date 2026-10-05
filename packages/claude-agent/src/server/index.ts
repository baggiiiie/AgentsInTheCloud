import { createCliAgentModule, emptyAgentInput, createCliModelSettings } from "@agents-in-the-cloud/cli-agent/server";
import { createPiModelRuntime, installSubscriptionCli, requireProviderSubscription } from "@agents-in-the-cloud/llm/server";
import { providerBrandIconHtml } from "@agents-in-the-cloud/shared";
import { claudeLaunchScript } from "./launch-command.ts";
import { prepareClaudeMcp } from "./mcp.ts";
import { loadClaudeTranscript, loadClaudeTranscriptImage, hasClaudeSession, hasClaudeTurnSettled, claudeHistoryFiles } from "./transcript.ts";

export const claudeModelSettings = createCliModelSettings({
  agentTypeId: "claude", provider: "anthropic", label: "Claude",
  mapThinkingLevel: (level, mapped) => mapped !== null && ["low", "medium", "high", "xhigh", "max"].includes(mapped ?? level) ? mapped ?? level : undefined,
});

export const agentsInTheCloudServerModule = createCliAgentModule({
  id: "claude", label: "Claude Code", iconHtml: providerBrandIconHtml("anthropic"),
  requireSetup: async () => requireProviderSubscription(await createPiModelRuntime(), "anthropic", "Claude"),
  settings: claudeModelSettings,
  prepareWorkspace: async (workspaceId) => installSubscriptionCli(workspaceId, await createPiModelRuntime()),
  prepareSession: prepareClaudeMcp,
  launchScript: claudeLaunchScript,
  resumeScript: async (_workspaceId, settings, session) => claudeLaunchScript(emptyAgentInput(), [], settings, session, await hasClaudeSession(session.id)),
  loadTranscript: loadClaudeTranscript,
  loadTranscriptImage: loadClaudeTranscriptImage,
  turnSettled: hasClaudeTurnSettled,
  historyFiles: claudeHistoryFiles,
});
