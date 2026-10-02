import { escapeHtml } from "@atelier/shared";
import { actionItemHtml, type ActionItemLabel, type ActionItemElement } from "../action-item/action-item-html.ts";
import { attributesHtml } from "../html.ts";

export interface TabStatus {
  busy?: boolean;
  requestingAttention?: boolean;
  /** Integration attributes for server updates and attention navigation. */
  attributesHtml?: string;
}

/** One shared slot for independent busy and attention states, including idle update targets. */
function tabStatusHtml(status: TabStatus = {}): string {
  const label = [status.busy && "Busy", status.requestingAttention && "Requesting attention"].filter(Boolean).join("; ");
  return `<span class="tab-strip__status"${attributesHtml(status.attributesHtml)} role="img" aria-label="${escapeHtml(label)}"${label ? "" : " hidden"}><span class="status-indicator"><i class="status-dot running" aria-hidden="true"${status.busy ? "" : " hidden"}></i><i class="status-dot attention" aria-hidden="true"${status.requestingAttention ? "" : " hidden"}></i></span></span>`;
}

/** Shared tab anatomy and status; features own selection, close forms and integration attributes. */
export function tabHtml(options: {
  label: ActionItemLabel;
  iconHtml?: string;
  status?: TabStatus;
  selected: boolean;
  primary: ActionItemElement;
  containerAttributesHtml?: string;
  closeHtml?: string;
}): string {
  return actionItemHtml({
    kind: "compound", label: options.label, leadingHtml: options.iconHtml, trailingHtml: tabStatusHtml(options.status),
    container: { attributesHtml: options.containerAttributesHtml },
    primary: { tag: options.primary.tag, attributesHtml: `role="tab" aria-selected="${options.selected}" tabindex="${options.selected ? 0 : -1}" ${options.primary.attributesHtml ?? ""}` },
    engagedActionsHtml: options.closeHtml,
  });
}

/** The wrapper owns sizing, overflow fades and an overlay scrollbar. Put fixed actions beside it. */
export function tabStripHtml(options: { id: string; label: string; tabsHtml: string }): string {
  const label = escapeHtml(options.label);
  const id = escapeHtml(options.id);
  return `<div id="${id}" class="tab-strip" data-controller="tab-strip" data-action="keydown->tab-strip#navigate wheel->tab-strip#wheel:!passive mouseover->tab-strip#engage focusin->tab-strip#engage turbo:before-morph-element->tab-strip#schedule"><div id="${id}_tabs" class="tab-strip__tabs" data-tab-strip-target="list" data-action="scroll->tab-strip#syncScroll" role="tablist" aria-label="${label}">${options.tabsHtml}</div><div id="${id}_scrollbar" class="tab-strip__scrollbar" data-tab-strip-target="scrollbar" data-action="pointerdown->tab-strip#dragStart pointermove->tab-strip#dragMove pointerup->tab-strip#dragEnd pointercancel->tab-strip#dragEnd lostpointercapture->tab-strip#dragEnd" role="scrollbar" aria-controls="${id}_tabs" aria-label="Scroll ${label}" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" tabindex="-1" hidden><div class="tab-strip__scrollbar-thumb"></div></div></div>`;
}
