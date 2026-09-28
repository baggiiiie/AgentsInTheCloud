import { Controller } from "@hotwired/stimulus";

/** One viewport boundary for the shell; panes and composers fit through layout. */
export class KeyboardViewportController extends Controller<HTMLElement> {
  private readonly viewport = window.visualViewport!;
  private frame = 0;

  connect(): void {
    this.viewport.addEventListener("resize", this.schedule);
    this.viewport.addEventListener("scroll", this.schedule);
    this.sync();
  }

  disconnect(): void {
    this.viewport.removeEventListener("resize", this.schedule);
    this.viewport.removeEventListener("scroll", this.schedule);
    cancelAnimationFrame(this.frame);
    this.element.style.removeProperty("--keyboard-viewport-top");
    this.element.style.removeProperty("--keyboard-viewport-height");
  }

  private readonly schedule = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.sync);
  };

  private readonly sync = (): void => {
    // Safari can pan as well as resize when focusing an input. Height alone
    // places the shell above the visible area after that pan. The visual
    // viewport is the browser's boundary, including native keyboard chrome.
    this.element.style.setProperty("--keyboard-viewport-top", `${this.viewport.offsetTop}px`);
    this.element.style.setProperty("--keyboard-viewport-height", `${this.viewport.height}px`);
  };
}
