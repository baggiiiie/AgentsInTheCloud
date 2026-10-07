export { validDraftId, agentAttachmentDraftId, stageAttachment, findStagedAttachment, listStagedAttachments, removeStagedAttachments, removeAttachmentDraft, moveAttachmentDraft, deliverAttachmentDraft, copyAttachmentIntoWorkspace, type StagedAttachment } from "./attachment-drafts.ts";
export { renderComposerBody, renderFloatingStack, renderFollowLatestButton, renderOpenComposerButton, composerAttachmentAttributes, agentComposerActions } from "./composer.ts";

import type { WorkspaceModule } from "@agents-in-the-cloud/shared";
import { handleAttachmentRequest } from "./attachment-routes.ts";
export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "prompt",
  staticFiles: { "/prompt.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" } },
  routes: [{ handle: handleAttachmentRequest }],
};
