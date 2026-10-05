import { escapeHtml } from "@agents-in-the-cloud/shared";
import type { ButtonVariant } from "../button/button-html.ts";
import { attributesHtml, classNames, htmlContent, type HtmlContent } from "../html.ts";

export type TransientFeedbackContent = HtmlContent;

type TransientFeedbackElement = ({ tag: "button"; variant?: ButtonVariant } | { tag: "div" }) & {
  /** Caller-owned attributes. Do not supply feedback state or controller attributes here. Attribute values containing external input must be escaped. */
  attributesHtml?: string;
}

interface TransientFeedbackContents {
  initialContent: TransientFeedbackContent;
  feedbackContent: TransientFeedbackContent;
  state: "initial" | "feedback";
  /** Milliseconds before returning to initial content; defaults to 2000. */
  durationMs?: number;
  /** Keeps button controls interactive while their feedback content is visible. */
  keepEnabledDuringFeedback?: boolean;
}

export type TransientFeedbackOptions = TransientFeedbackContents & (
  | { element: Extract<TransientFeedbackElement, { tag: "button" }>; /** Persistent caption; state content occupies a fixed icon slot. */ caption?: string; layout?: never }
  | { element: Extract<TransientFeedbackElement, { tag: "button" }>; /** Both states share a centered slot, preserving the larger content's size. */ layout: "overlay"; caption?: never }
  | { element: Extract<TransientFeedbackElement, { tag: "div" }>; caption?: never; layout?: never }
);

/**
 * Renders content which briefly acknowledges a completed action before restoring
 * its initial content. Captioned buttons reserve an icon slot; overlay buttons
 * replace their caption with centered feedback without changing the hit target.
 */
export function transientFeedbackHtml(options: TransientFeedbackOptions): string {
  return transientFeedbackMarkup(options, classNames("transient-feedback", options.element.tag === "button" && "button", options.element.tag === "button" && (options.element.variant ?? "secondary")));
}

/** Shared by components that render transient feedback under their own class names. */
export function transientFeedbackMarkup(options: TransientFeedbackOptions, className: string): string {
  const { element } = options;
  const classes = classNames(className, options.caption !== undefined && "transient-feedback--caption", options.layout === "overlay" && "transient-feedback--overlay");
  const caption = options.caption === undefined ? "" : `<span class="button__caption">${escapeHtml(options.caption)}</span>`;
  const contentTag = element.tag === "button" ? "span" : "div";
  const initialHidden = options.state === "feedback" ? " hidden" : "";
  const feedbackHidden = options.state === "initial" ? " hidden" : "";
  const duration = options.durationMs === undefined ? "" : ` data-transient-feedback-duration-value="${options.durationMs}"`;
  const keepEnabled = options.keepEnabledDuringFeedback ? " data-transient-feedback-keep-enabled" : "";
  const disabled = element.tag === "button" && options.state === "feedback" && !options.keepEnabledDuringFeedback ? " disabled" : "";

  return `<${element.tag} class="${escapeHtml(classes)}" data-controller="transient-feedback" data-transient-feedback-state-value="${options.state}"${duration}${keepEnabled}${attributesHtml(element.attributesHtml)}${disabled}><${contentTag} class="transient-feedback__content" data-transient-feedback-content="initial"${initialHidden}>${htmlContent(options.initialContent)}</${contentTag}><${contentTag} class="transient-feedback__content" data-transient-feedback-content="feedback" role="status"${feedbackHidden}>${htmlContent(options.feedbackContent)}</${contentTag}>${caption}</${element.tag}>`;
}
