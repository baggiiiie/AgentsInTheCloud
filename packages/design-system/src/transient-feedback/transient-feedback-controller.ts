/// <reference lib="dom" />

import { Controller } from "@hotwired/stimulus";

const feedbackDurationMs = 2_000;
const showEvent = "transient-feedback:show";

export function showTransientFeedback(element: HTMLElement): void {
  element.dispatchEvent(new CustomEvent(showEvent));
}

export class TransientFeedbackController extends Controller<HTMLElement> {
  static values = { state: { type: String, default: "initial" }, duration: { type: Number, default: feedbackDurationMs } };

  declare stateValue: "initial" | "feedback";
  declare durationValue: number;
  private timer?: ReturnType<typeof setTimeout>;

  connect(): void {
    this.element.addEventListener(showEvent, this.show);
    this.element.addEventListener("animationend", this.returned);
    this.element.addEventListener("animationcancel", this.returned);
  }

  disconnect(): void {
    this.element.removeEventListener(showEvent, this.show);
    this.element.removeEventListener("animationend", this.returned);
    this.element.removeEventListener("animationcancel", this.returned);
    if (this.timer) clearTimeout(this.timer);
  }

  stateValueChanged(_state: string, previousState: string): void {
    this.element.toggleAttribute("data-transient-feedback-returning", this.stateValue === "initial" && previousState === "feedback" && this.element.classList.contains("transient-feedback--overlay") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.render();
    if (this.stateValue !== "feedback") return;
    const disableDuringFeedback = this.element instanceof HTMLButtonElement && !this.element.hasAttribute("data-transient-feedback-keep-enabled");
    if (disableDuringFeedback) this.element.disabled = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (disableDuringFeedback) this.element.disabled = false;
      this.stateValue = "initial";
      this.timer = undefined;
    }, this.durationValue);
  }

  private readonly returned = (event: AnimationEvent): void => {
    if (event.target === this.element && event.animationName === "transient-feedback-settle") this.element.removeAttribute("data-transient-feedback-returning");
  };

  private readonly show = (): void => {
    this.stateValue = "feedback";
  };

  private render(): void {
    const feedback = this.stateValue === "feedback";
    this.element.querySelector<HTMLElement>(':scope > [data-transient-feedback-content="initial"]')!.hidden = feedback;
    this.element.querySelector<HTMLElement>(':scope > [data-transient-feedback-content="feedback"]')!.hidden = !feedback;
    const label = feedback ? this.element.dataset.transientFeedbackFeedbackLabel : this.element.dataset.transientFeedbackInitialLabel;
    if (label !== undefined) this.element.setAttribute("aria-label", label);
  }
}
