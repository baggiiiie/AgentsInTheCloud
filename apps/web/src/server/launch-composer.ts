import { composerAttachmentAttributes, renderComposerBody } from "@agents-in-the-cloud/prompt/server";
import { actionItemHtml } from "@agents-in-the-cloud/design-system/action-item";
import { popupHtml } from "@agents-in-the-cloud/design-system/popup";
import { transcriptionComposerController } from "@agents-in-the-cloud/transcription/server";
import { domId, escapeHtml, type AgentLaunchFooterContext, type WorkspaceAgentProvider } from "@agents-in-the-cloud/shared";

/** Host-owned launch composer content. */
export interface AgentLaunchPresentation {
  attributesHtml: string;
  formAttributesHtml: string;
  bodyHtml: string;
  footerHtml: string;
  discardUrl: string;
}
const launchProviderFrameId = "launch_composer_provider";

export async function renderLaunchProvider(provider: WorkspaceAgentProvider, providers: readonly WorkspaceAgentProvider[], context: AgentLaunchFooterContext): Promise<string> {
  const selectionFormId = `${launchProviderFrameId}_selection`;
  const picker = popupHtml({
    id: `${launchProviderFrameId}_menu`, label: "Agent provider", placement: "above",
    trigger: { variant: "secondary", content: { kind: "caption", caption: provider.label, iconHtml: provider.iconHtml } },
    contentHtml: providers.map((item) => actionItemHtml({
      kind: "single", label: { kind: "text", text: item.label }, leadingHtml: item.iconHtml,
      element: { tag: "button", attributesHtml: `type="submit" name="provider" value="${escapeHtml(item.id)}" form="${selectionFormId}" role="menuitemradio" aria-checked="${item.id === provider.id}"` },
    })).join(""),
  });
  return `<turbo-frame id="${launchProviderFrameId}">
    <form id="${selectionFormId}" method="get" action="/launch-composer/provider" data-turbo-frame="${launchProviderFrameId}" hidden></form>
    <input type="hidden" name="provider" value="${escapeHtml(provider.id)}" form="${escapeHtml(context.formId)}">
    ${picker}
    ${await provider.launch.renderFooter(context)}
  </turbo-frame>`;
}

/** The host owns text and attachments; provider switches replace only the settings footer. */
export async function launchComposerContent(options: { draftId: string; provider: WorkspaceAgentProvider; providers: readonly WorkspaceAgentProvider[]; context: AgentLaunchFooterContext; workspaceTemplateId?: string }): Promise<AgentLaunchPresentation> {
  const { draftId } = options;
  const rowId = domId("agent_draft_attach", draftId);
  return {
    attributesHtml: `data-controller="agent-attachments ${transcriptionComposerController}"${options.workspaceTemplateId ? ` data-transcription-composer-workspace-template-id-value="${escapeHtml(options.workspaceTemplateId)}"` : ""} ${composerAttachmentAttributes(draftId, rowId, "click->launch-composer-dialog#focusText")}`,
    formAttributesHtml: 'data-action="submit->transcription-composer#submit keydown->submit-shortcut#keydown submit->submit-shortcut#submit turbo:submit-end->launch-composer-dialog#submitted turbo:submit-end->submit-shortcut#submitted"',
    bodyHtml: renderComposerBody({
      draft: { id: draftId, rowId },
      inputHtml: `<textarea class="composer-input" name="text" placeholder="Describe what you want the agent to do… (optional)" aria-label="Initial agent prompt" data-action="paste->agent-attachments#paste"></textarea>`,
    }),
    footerHtml: await renderLaunchProvider(options.provider, options.providers, options.context),
    discardUrl: `/agent-attachment-drafts/${encodeURIComponent(draftId)}/discard`,
  };
}

export function renderLaunchComposer(options: { action: string; formId: string; content: AgentLaunchPresentation }): string {
  const { content } = options;
  return `<div class="composer launch-composer" ${content.attributesHtml}>
    <div class="composer-surface">
      <form id="${escapeHtml(options.formId)}" method="post" action="${escapeHtml(options.action)}" data-turbo="true" ${content.formAttributesHtml}>
        ${content.bodyHtml}
      </form>
      <div class="composer-footer">${content.footerHtml}</div>
    </div>
  </div>`;
}
