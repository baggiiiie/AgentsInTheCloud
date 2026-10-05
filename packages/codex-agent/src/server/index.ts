import { prepareCodexMcp } from "./mcp.ts";
import { createCliAgentModule, emptyAgentInput, createCliModelSettings } from "@agents-in-the-cloud/cli-agent/server";
import { createPiModelRuntime, installSubscriptionCli, requireProviderSubscription } from "@agents-in-the-cloud/llm/server";
import { providerBrandIconHtml } from "@agents-in-the-cloud/shared";
import { codexLaunchScript } from "./launch-command.ts";
import { loadCodexTranscript, loadCodexTranscriptImage, codexResumeId, codexHistoryFiles } from "./transcript.ts";

export const codexModelSettings = createCliModelSettings({
  agentTypeId: "codex", provider: "openai-codex", label: "Codex",
  mapThinkingLevel: (level, mapped) => mapped === null ? undefined : mapped ?? (level === "off" ? "none" : level),
});

export const agentsInTheCloudServerModule = createCliAgentModule({
  id: "codex", label: "Codex", iconHtml: providerBrandIconHtml("openai"),
  requireSetup: async () => requireProviderSubscription(await createPiModelRuntime(), "openai-codex", "Codex"),
  settings: codexModelSettings,
  prepareWorkspace: async (workspaceId) => installSubscriptionCli(workspaceId, await createPiModelRuntime()),
  prepareSession: prepareCodexMcp,
  launchScript: codexLaunchScript,
  resumeScript: async (workspaceId, settings, session) => codexLaunchScript(emptyAgentInput(), [], settings, session, await codexResumeId(workspaceId, session.id)),
  loadTranscript: loadCodexTranscript,
  loadTranscriptImage: loadCodexTranscriptImage,
  historyFiles: codexHistoryFiles,
});
