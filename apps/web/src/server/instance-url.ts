import { copyButtonHtml } from "@agents-in-the-cloud/design-system/copy-button";
import { qrCodeButtonHtml, qrCodeDialogHtml } from "@agents-in-the-cloud/design-system/qr-code";
import { escapeHtml } from "@agents-in-the-cloud/shared";

/** Link, copy and QR actions for this instance's external URL. Render outside forms. */
export function instanceUrlHtml(instanceUrl: string, qrDialogId: string): string {
  return `<div class="instance-url"><a href="${escapeHtml(instanceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(instanceUrl)}</a>${copyButtonHtml({ label: "Copy external URL", copyText: instanceUrl })}${qrCodeButtonHtml(qrDialogId, "Open on your phone")}</div>${qrCodeDialogHtml(qrDialogId, instanceUrl)}`;
}
