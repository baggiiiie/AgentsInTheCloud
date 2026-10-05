import { createCliAgentModule, emptyAgentInput } from "@agents-in-the-cloud/cli-agent/server";
import { createPiModelRuntime } from "@agents-in-the-cloud/llm/server";
import { registerWorkspaceRequestTransform } from "@agents-in-the-cloud/proxy-egress/server";
import { providerBrandIconHtml, type WorkspaceModule } from "@agents-in-the-cloud/shared";
import { installPiCliConfiguration } from "./pi-cli.ts";
import { createPiCliCredentialTransform, piCliCredentialHosts } from "./pi-cli-bridge.ts";
import { requirePiModels } from "./auth.ts";
import { piLaunchScript } from "./launch-command.ts";
import { preparePiSession } from "./session.ts";
import { piModelSettings } from "./model-settings.ts";
import { loadPiTranscript, loadPiTranscriptImage, piResumePath, piHistoryFiles } from "./transcript.ts";

const cliModule = createCliAgentModule({
  id: "pi", label: "Pi", iconHtml: providerBrandIconHtml("pi", "Pi"),
  requireSetup: requirePiModels,
  settings: piModelSettings,
  prepareWorkspace: installPiCliConfiguration,
  prepareSession: preparePiSession,
  launchScript: piLaunchScript,
  resumeScript: async (workspaceId, settings, session) => piLaunchScript(emptyAgentInput(), [], settings, session, await piResumePath(workspaceId, session.id)),
  loadTranscript: loadPiTranscript,
  loadTranscriptImage: loadPiTranscriptImage,
  historyFiles: piHistoryFiles,
});

export const agentsInTheCloudServerModule: WorkspaceModule = {
  ...cliModule,
  initialize(context) {
    cliModule.initialize!(context);
    registerWorkspaceRequestTransform("pi-cli", createPiCliCredentialTransform(createPiModelRuntime), async () => piCliCredentialHosts(await createPiModelRuntime()));
  },
};
