import { escapeHtml } from "@agents-in-the-cloud/shared";
import { attributesHtml, classNames } from "../html.ts";

export interface PanelOptions {
  element: {
    tag: "aside" | "div" | "section";
    /** Caller-owned attributes. Attribute values containing external input must be escaped. */
    attributesHtml?: string;
  };
  /** Trusted, already-escaped header contents. Omit when the surface needs no header. */
  headerHtml?: string;
  /** Trusted, already-escaped body contents. */
  bodyHtml: string;
  bodyLayout?: "padded" | "full-bleed";
  bodyOverflow?: "scroll" | "contained";
  /** Trusted, already-escaped footer contents. Omit when the surface has no footer actions. */
  footerHtml?: string;
}

/** Renders a bounded surface with fixed chrome around a flexible body. */
export function panelHtml(options: PanelOptions): string {
  const { element } = options;
  const header = options.headerHtml === undefined ? "" : `<header class="panel__header">${options.headerHtml}</header>`;
  const footer = options.footerHtml === undefined ? "" : `<footer class="panel__footer">${options.footerHtml}</footer>`;
  return `<${element.tag} class="${escapeHtml("panel")}"${attributesHtml(element.attributesHtml)}>${header}<div class="${escapeHtml(classNames("panel__body", options.bodyLayout === "padded" && "panel__body--padded", options.bodyOverflow === "scroll" && "panel__body--scroll"))}">${options.bodyHtml}</div>${footer}</${element.tag}>`;
}
