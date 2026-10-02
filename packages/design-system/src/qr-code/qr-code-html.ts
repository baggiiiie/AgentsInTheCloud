import qrcode from "qrcode-generator";
import { escapeHtml } from "@agents-in-the-cloud/shared";
import { buttonHtml } from "../button/button-html.ts";
import { dialogHtml } from "../dialog/dialog-html.ts";
import { Icons } from "../icons/icons-html.ts";

/** Icon-only button that natively opens the dialog with id `dialogId`. */
export function qrCodeButtonHtml(dialogId: string, label: string, disabled = false): string {
  return buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.QrCode, label }, disabled, attributesHtml: `commandfor="${escapeHtml(dialogId)}" command="show-modal"` });
}

/** Dialog with a QR code for `url`. Render it outside forms; it contains a close form. */
export function qrCodeDialogHtml(id: string, url: string): string {
  const code = qrcode(0, "M");
  code.addData(url);
  code.make();
  return dialogHtml({
    element: { id, attributesHtml: "data-qr-code-dialog" },
    iconHtml: Icons.QrCode,
    titleCaption: "Open on your phone",
    bodyHtml: `<div class="qr-code"><div class="qr-code__image" role="img" aria-label="QR code for ${escapeHtml(url)}">${code.createSvgTag({ cellSize: 4, margin: 16, scalable: true })}</div><a class="qr-code__url" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></div>`,
  });
}
