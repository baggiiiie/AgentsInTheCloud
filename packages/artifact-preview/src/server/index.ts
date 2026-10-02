import { registerMarkdownEmbed } from "@atelier/markdown";
import type { WorkspaceModule } from "@atelier/shared";
import { renderArtifactPreview } from "./render-reference.ts";

export const atelierServerModule: WorkspaceModule = {
  id: "artifact-preview",
  staticFiles: {
    "/artifact-preview.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" },
  },
  initialize() {
    registerMarkdownEmbed("artifact-preview", ({ workspaceId, target }) => renderArtifactPreview(workspaceId, target));
  },
};
