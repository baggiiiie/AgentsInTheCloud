import { createCliAgentModule, createCliModelSettings } from "@atelier/cli-agent/server";
import { createPiModelRuntime, installSubscriptionCli, requireProviderSubscription } from "@atelier/llm/server";
import { providerBrandIconHtml } from "@atelier/shared";
import { claudeLaunchScript } from "./launch-command.ts";
import { prepareClaudeMcp } from "./mcp.ts";
import { loadClaudeTranscript, loadClaudeTranscriptImage, hasClaudeSession } from "./transcript.ts";

export const claudeModelSettings = createCliModelSettings({
  agentProvider: "claude", provider: "anthropic", label: "Claude",
  effort: (level, mapped) => mapped !== null && ["low", "medium", "high", "xhigh", "max"].includes(mapped ?? level) ? mapped ?? level : undefined,
});

export const atelierServerModule = createCliAgentModule({
  id: "claude", label: "Claude Code", iconHtml: providerBrandIconHtml("anthropic"),
  requireSetup: async () => requireProviderSubscription(await createPiModelRuntime(), "anthropic", "Claude"),
  settings: claudeModelSettings,
  prepareWorkspace: async (workspaceId) => installSubscriptionCli(workspaceId, await createPiModelRuntime()),
  prepareSession: prepareClaudeMcp,
  launchScript: claudeLaunchScript,
  resumeScript: async (_workspaceId, settings, session) => claudeLaunchScript({ text: "", images: [], attachmentNotes: [] }, [], settings, session, await hasClaudeSession(session.id)),
  loadTranscript: loadClaudeTranscript,
  loadTranscriptImage: loadClaudeTranscriptImage,
});
