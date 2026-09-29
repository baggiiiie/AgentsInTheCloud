import { buttonHtml } from "@atelier/design-system/button";
import { Icons } from "@atelier/design-system/icons";
import { renderTranscriptionComposerControl } from "@atelier/transcription/server";
import { escapeHtml } from "@atelier/shared";
import { renderAttachmentChip, renderAttachmentPicker } from "./render-attachments.ts";
import type { StagedAttachment } from "./attachment-drafts.ts";

export const agentComposerActions = "atelier:workspace-pane-visible@document->agent-composer#selected atelier:workspace-pane-hidden@document->agent-composer#hidden agent-attachments:files->agent-composer#reveal";

const sendIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5m-4 4 4-4 4 4"/></svg>';

/** The shared form body; each host owns its form, supplementary UI, and optional footer. */
export function renderComposerBody(options: {
  draft: { id: string; rowId: string; attachments?: readonly StagedAttachment[] };
  inputHtml: string;
  sendHtml?: string;
  collapsible?: boolean;
}): string {
  const { draft } = options;
  const send = options.sendHtml ?? buttonHtml({ type: "submit", variant: "primary", content: { kind: "icon-only", iconHtml: sendIcon, label: "Send prompt" }, attributesHtml: "data-popular-button" });
  return `<input type="hidden" name="attachmentDraft" value="${escapeHtml(draft.id)}">
    <div class="agent-attach-row" id="${escapeHtml(draft.rowId)}" data-agent-attachments-target="row">${(draft.attachments ?? []).map((attachment) => renderAttachmentChip(attachment, draft.id)).join("")}</div>
    <div class="composer-input-area">${options.inputHtml}<div class="composer-input-controls">${options.collapsible ? buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Close, label: "Close composer" }, attributesHtml: 'data-popular-button data-action="agent-composer#close"' }) : ""}${renderTranscriptionComposerControl()}${renderAttachmentPicker("icon-only")}</div></div>
    <div class="composer-actions"><span class="spacer"></span>${send}</div>
    <p role="status" data-agent-attachments-target="status" hidden></p>`;
}

export function renderOpenComposerButton(): string {
  return `<div class="agent-composer-opener">${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Keyboard, label: "Open composer" }, attributesHtml: 'data-popular-button data-action="agent-composer#open"' })}</div>`;
}

export function composerAttachmentAttributes(draftId: string, rowId: string, actions = ""): string {
  const uploadUrl = `/agent-attachment-drafts/${encodeURIComponent(draftId)}/attachments?row=${encodeURIComponent(rowId)}`;
  return `data-agent-attachments-upload-url-value="${escapeHtml(uploadUrl)}" data-action="${actions} mousedown->composer-focus#preserveInputFocus dragover->agent-attachments#dragOver dragleave->agent-attachments#dragLeave drop->agent-attachments#drop"`;
}
