import { escapeHtml } from "@agents-in-the-cloud/shared";
import { buttonPresentation } from "../button/button-content.ts";
import { attributesHtml, classNames } from "../html.ts";
import { Icons } from "../icons/icons-html.ts";
import type { ButtonConfirmationOptions } from "./button-confirmation-html.ts";

/** Package-private composition seam for the standalone and clipboard buttons. */
export function buttonConfirmationMarkup(options: ButtonConfirmationOptions, roleClass?: "copy-button"): string {
  const presentation = buttonPresentation(options.variant, options.content);
  const label = options.label ?? (options.content.kind === "caption" ? options.content.caption : options.content.label);
  const confirmed = options.confirmed ?? false;
  const title = options.label !== undefined || options.content.kind === "icon-only" ? ` title="${escapeHtml(label)}"` : "";
  return `<button class="${classNames(presentation.className, "button-confirmation", roleClass)}" type="${options.type}"${title} aria-label="${escapeHtml(confirmed ? options.confirmationLabel : label)}"${options.disabled ? " disabled" : ""} data-controller="button-confirmation" data-button-confirmation-confirmed-value="${confirmed}" data-button-confirmation-label-value="${escapeHtml(label)}" data-button-confirmation-confirmed-label-value="${escapeHtml(options.confirmationLabel)}"${attributesHtml(options.attributesHtml)}><span class="button-confirmation__content button-confirmation__initial" data-button-confirmation-target="initial" aria-hidden="${confirmed}">${presentation.contentHtml}</span><span class="button-confirmation__content button-confirmation__check" data-button-confirmation-target="check" role="status" aria-label="${escapeHtml(options.confirmationLabel)}" aria-hidden="${!confirmed}">${Icons.Check}</span></button>`;
}
