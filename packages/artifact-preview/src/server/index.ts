import { registerMarkdownEmbed } from "@agents-in-the-cloud/markdown";
import type { WorkspaceModule } from "@agents-in-the-cloud/shared";
import { renderArtifactPreview } from "./render-reference.ts";

export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "artifact-preview",
  staticFiles: {
    "/artifact-preview.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" },
  },
  initialize() {
    registerMarkdownEmbed("artifact-preview", ({ workspaceId, target }) => renderArtifactPreview(workspaceId, target));
  },
};
