/// <reference lib="dom" />

import { Controller } from "@hotwired/stimulus";

/** Measure browser-sized auxiliary controls, including groups and confirmations. */
export class ActionItemActionsController extends Controller<HTMLElement> {
  private observer!: ResizeObserver;

  connect(): void {
    const item = this.element.parentElement!;
    const update = (): void => {
      item.style.setProperty("--action-item-actions-width", `${this.element.getBoundingClientRect().width}px`);
    };
    update();
    this.observer = new ResizeObserver(update);
    this.observer.observe(this.element);
  }

  disconnect(): void {
    this.observer.disconnect();
  }
}
