import { registerMarkdownEmbed } from "@atelier/markdown";
import type { WorkspaceModule } from "@atelier/shared";
import { handleRichResponseRequest } from "./rich-response-routes.ts";
import { renderRichResponseReference } from "./render-reference.ts";

export const atelierServerModule: WorkspaceModule = {
  id: "rich-response",
  staticFiles: {
    "/rich-response.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" },
  },
  routes: [{ handle: handleRichResponseRequest }],
  initialize() {
    registerMarkdownEmbed("atelier-rich", renderRichResponseReference);
  },
};
