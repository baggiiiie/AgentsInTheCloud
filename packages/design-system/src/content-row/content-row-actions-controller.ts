/// <reference lib="dom" />

import { Controller } from "@hotwired/stimulus";

/** Measure browser-sized auxiliary controls, including groups and confirmations. */
export class ContentRowActionsController extends Controller<HTMLElement> {
  private observer!: ResizeObserver;

  connect(): void {
    const item = this.element.parentElement!;
    const update = (): void => {
      item.style.setProperty("--content-row-actions-width", `${this.element.getBoundingClientRect().width}px`);
    };
    update();
    this.observer = new ResizeObserver(update);
    this.observer.observe(this.element);
  }

  disconnect(): void {
    this.observer.disconnect();
  }
}
