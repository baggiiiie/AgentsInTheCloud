import type { WorkspaceModule } from "@agents-in-the-cloud/shared";
import { createTranscriptionSocketSession } from "./realtime.ts";
import { transcriptionSettingsContribution } from "./settings.ts";

const transcriptionStaticFiles = {
  "/transcription.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" },
} as const;

export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "transcription",
  staticFiles: transcriptionStaticFiles,
  settingsContributions: [transcriptionSettingsContribution],
  initialize(context) {
    context.registerSocketHandler(createTranscriptionSocketSession);
  },
};

export { renderTranscriptionComposerControl, transcriptionComposerController } from "./composer.ts";
