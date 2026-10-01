import { prepareCodexMcp } from "./mcp.ts";
import { createCliAgentModule, createCliModelSettings } from "@atelier/cli-agent/server";
import { createPiModelRuntime, installSubscriptionCli, requireProviderSubscription } from "@atelier/llm/server";
import { providerBrandIconHtml } from "@atelier/shared";
import { codexLaunchScript } from "./launch-command.ts";
import { loadCodexTranscript, loadCodexTranscriptImage } from "./transcript.ts";

export const codexModelSettings = createCliModelSettings({
  agentProvider: "codex", provider: "openai-codex", label: "Codex",
  effort: (level, mapped) => mapped === null ? undefined : mapped ?? (level === "off" ? "none" : level),
});

export const atelierServerModule = createCliAgentModule({
  id: "codex", label: "Codex", iconHtml: providerBrandIconHtml("openai"),
  requireSetup: async () => requireProviderSubscription(await createPiModelRuntime(), "openai-codex", "Codex"),
  settings: codexModelSettings,
  prepareWorkspace: async (workspaceId) => installSubscriptionCli(workspaceId, await createPiModelRuntime()),
  prepareSession: prepareCodexMcp,
  launchScript: codexLaunchScript,
  loadTranscript: loadCodexTranscript,
  loadTranscriptImage: loadCodexTranscriptImage,
});
