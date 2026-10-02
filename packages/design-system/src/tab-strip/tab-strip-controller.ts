import { Controller } from "@hotwired/stimulus";
import type { TabStatus } from "./tab-strip-html.ts";

/** Browser-owned status changes; server-owned states are rendered by tabHtml. */
export function setTabStatus(tab: HTMLElement, state: Pick<TabStatus, "busy" | "requestingAttention">): void {
  const status = tab.querySelector<HTMLElement>(".tab-strip__status")!;
  status.querySelector<HTMLElement>(".running")!.hidden = !state.busy;
  status.querySelector<HTMLElement>(".attention")!.hidden = !state.requestingAttention;
  status.hidden = !state.busy && !state.requestingAttention;
  status.setAttribute("aria-label", [state.busy && "Busy", state.requestingAttention && "Requesting attention"].filter(Boolean).join("; "));
}

/** Owns tab geometry, clipping, keyboard navigation and the overlay scrollbar. */
export class TabStripController extends Controller<HTMLElement> {
  static targets = ["list", "scrollbar"];
  declare listTarget: HTMLElement;
  declare scrollbarTarget: HTMLElement;
  private resize = new ResizeObserver(() => this.schedule());
  private mutations = new MutationObserver(records => {
    if (records.some(record => record.type === "childList")) this.observeGeometry();
    this.schedule();
  });
  private frame = 0;
  private animationFrame = 0;
  private selected: HTMLElement | null = null;
  private drag: { pointerId: number; x: number; position: number } | null = null;
  private get items() { return [...this.listTarget.querySelectorAll<HTMLElement>(":scope > .action-item:not([hidden])")]; }
  private get maximum() { return Math.max(0, this.listTarget.scrollWidth - this.listTarget.clientWidth); }
  private get rtl() { return getComputedStyle(this.listTarget).direction === "rtl"; }
  // A physical left-to-right position, including the negative native RTL scroll range.
  private get position() { return Math.max(0, Math.min(this.maximum, this.rtl ? this.maximum + this.listTarget.scrollLeft : this.listTarget.scrollLeft)); }
  private set position(value: number) { this.listTarget.scrollLeft = this.rtl ? value - this.maximum : value; }

  connect(): void {
    this.mutations.observe(this.listTarget, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-selected", "hidden", "dir"] });
    this.observeGeometry();
    document.fonts.addEventListener("loadingdone", this.schedule);
    this.schedule();
  }
  disconnect(): void {
    this.resize.disconnect(); this.mutations.disconnect();
    cancelAnimationFrame(this.frame); cancelAnimationFrame(this.animationFrame);
    document.fonts.removeEventListener("loadingdone", this.schedule);
    this.frame = this.animationFrame = 0;
    this.drag = null;
  }
  private observeGeometry(): void {
    this.resize.disconnect();
    this.resize.observe(this.element);
    for (const slot of this.listTarget.querySelectorAll(".action-item__label, .action-item__icon, .action-item__actions")) this.resize.observe(slot);
  }
  readonly schedule = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.layout(); });
  };
  private layout(): void {
    // Hidden panes are measured when ResizeObserver reports that they are visible.
    if (!this.element.clientWidth) return;
    for (const item of this.items) {
      const primary = item.querySelector<HTMLElement>(".action-item__primary")!;
      primary.tabIndex = primary.getAttribute("aria-selected") === "true" ? 0 : -1;
      const icon = item.querySelector<HTMLElement>(".action-item__icon");
      const status = item.querySelector<HTMLElement>(".tab-strip__status")!;
      const actions = item.querySelector<HTMLElement>(".action-item__actions");
      const actionsStyle = actions && getComputedStyle(actions);
      const inlineActions = actionsStyle?.position === "static" && actionsStyle.display !== "none";
      const showStatus = !status.hidden && !inlineActions;
      // Hover-hidden metadata still contributes to preferred width. Close is
      // overlaid on desktop, so engagement never changes the tab's outer size.
      const statusWidth = showStatus ? parseFloat(getComputedStyle(status.firstElementChild!).width) : 0;
      const itemStyle = getComputedStyle(item), primaryStyle = getComputedStyle(primary);
      const padding = [itemStyle.paddingInlineStart, itemStyle.paddingInlineEnd, primaryStyle.paddingInlineStart, primaryStyle.paddingInlineEnd].reduce((sum, value) => sum + parseFloat(value), 0);
      const gaps = parseFloat(primaryStyle.columnGap) * (Number(!!icon) + Number(showStatus));
      const actionWidth = inlineActions ? actions!.getBoundingClientRect().width : 0;
      const natural = Math.ceil(this.titleBounds(item).width + (icon?.getBoundingClientRect().width ?? 0) + statusWidth + padding + gaps + actionWidth);
      item.style.setProperty("--tab-content-width", `${natural}px`);
    }
    const selected = this.items.find(item => item.querySelector('[aria-selected="true"]')) ?? null;
    if (selected !== this.selected) {
      this.selected = selected;
      selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    this.syncScroll(); this.updateTitleFades();
  }
  syncScroll(): void {
    const maximum = this.maximum, position = this.position;
    this.listTarget.toggleAttribute("data-cut-left", position > 1);
    this.listTarget.toggleAttribute("data-cut-right", maximum - position > 1);
    this.scrollbarTarget.hidden = maximum <= 1;
    this.scrollbarTarget.tabIndex = maximum > 1 ? 0 : -1;
    this.scrollbarTarget.setAttribute("aria-valuemax", String(maximum));
    this.scrollbarTarget.setAttribute("aria-valuenow", String(Math.round(position)));
    const width = this.scrollbarTarget.clientWidth;
    const thumb = Math.min(width, Math.max(28, width * this.listTarget.clientWidth / this.listTarget.scrollWidth));
    this.scrollbarTarget.style.setProperty("--tab-scroll-thumb-width", `${thumb}px`);
    this.scrollbarTarget.style.setProperty("--tab-scroll-thumb-offset", `${maximum ? position / maximum * (width - thumb) : 0}px`);
  }
  private titleBounds(item: HTMLElement): DOMRect {
    const range = document.createRange();
    range.selectNodeContents(item.querySelector(".action-item__label-text")!);
    return range.getBoundingClientRect();
  }
  private updateTitleFades(): void {
    for (const item of this.items) {
      const viewport = item.querySelector(".action-item__label")!.getBoundingClientRect();
      const text = this.titleBounds(item);
      item.toggleAttribute("data-title-cut-left", text.left < viewport.left - 1);
      item.toggleAttribute("data-title-cut-right", text.right > viewport.right + 1);
    }
  }
  engage(): void {
    this.schedule();
    if (this.animationFrame) return;
    // Action item's existing hover controller starts its marquee later in the
    // same event bubble. Track the actual moving text edges, not a permanent mask.
    this.animationFrame = requestAnimationFrame(this.animateFades);
  }
  private readonly animateFades = (): void => {
    this.animationFrame = 0;
    if (!this.element.clientWidth) return;
    this.updateTitleFades();
    if (this.listTarget.querySelector(".is-label-scrolling") && !matchMedia("(prefers-reduced-motion: reduce)").matches) this.animationFrame = requestAnimationFrame(this.animateFades);
  };
  wheel(event: WheelEvent): void {
    if (event.ctrlKey || (event.deltaX !== 0 && !event.shiftKey) || !this.maximum) return;
    const amount = event.deltaX || event.deltaY * (this.rtl ? -1 : 1);
    const delta = amount * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.listTarget.clientWidth : 1);
    if ((delta > 0 && this.position >= this.maximum - 1) || (delta < 0 && this.position <= 0)) return;
    event.preventDefault(); this.position += delta;
  }
  dragStart(event: PointerEvent): void {
    if (event.button !== 0) return;
    const thumb = this.scrollbarTarget.firstElementChild!.getBoundingClientRect();
    if (event.clientX < thumb.left || event.clientX > thumb.right) this.position = (event.clientX - this.scrollbarTarget.getBoundingClientRect().left - thumb.width / 2) / (this.scrollbarTarget.clientWidth - thumb.width) * this.maximum;
    this.drag = { pointerId: event.pointerId, x: event.clientX, position: this.position };
    this.scrollbarTarget.setPointerCapture(event.pointerId);
    this.scrollbarTarget.setAttribute("data-dragging", "");
    event.preventDefault();
  }
  dragMove(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const travel = this.scrollbarTarget.clientWidth - this.scrollbarTarget.firstElementChild!.getBoundingClientRect().width;
    this.position = this.drag.position + (event.clientX - this.drag.x) * this.maximum / travel;
  }
  dragEnd(): void { this.scrollbarTarget.removeAttribute("data-dragging"); this.drag = null; }
  navigate(event: KeyboardEvent): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    if (event.target === this.scrollbarTarget) {
      event.preventDefault();
      if (event.key === "Home") this.position = this.rtl ? this.maximum : 0;
      else if (event.key === "End") this.position = this.rtl ? 0 : this.maximum;
      else this.position += event.key === "ArrowRight" ? 64 : -64;
      return;
    }
    const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="tab"]') : null;
    if (!tab) return;
    const tabs = this.items.map(item => item.querySelector<HTMLElement>('[role="tab"]')!).filter(item => !item.matches(':disabled, [aria-disabled="true"]'));
    if (tabs.length < 2) return;
    event.preventDefault();
    const direction = (event.key === "ArrowRight" ? 1 : -1) * (this.rtl ? -1 : 1);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (tabs.indexOf(tab) + direction + tabs.length) % tabs.length;
    tabs[next]!.click(); tabs[next]!.focus();
  }
}
