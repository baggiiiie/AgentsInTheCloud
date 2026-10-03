export * from "./attachment-drafts.ts";
export { renderComposerBody, renderFloatingStack, renderFollowLatestButton, renderOpenComposerButton, composerAttachmentAttributes, agentComposerActions } from "./composer.ts";
export { renderAttachmentChip, renderAttachmentPicker } from "./render-attachments.ts";
import type { WorkspaceModule } from "@agents-in-the-cloud/shared";
import { handleAttachmentRequest } from "./attachment-routes.ts";
export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "prompt",
  staticFiles: { "/prompt.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" } },
  routes: [{ handle: handleAttachmentRequest }],
};
