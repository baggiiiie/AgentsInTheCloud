import type { WorkspaceClientControllerConstructor } from "@atelier/shared";
import type { ObservableTerminalViewer } from "./index.ts";

const terminalAccessoryInput = new Map([
  ["escape", "\x1b"],
  ["up", "\x1b[A"],
  ["down", "\x1b[B"],
  ["right", "\x1b[C"],
  ["left", "\x1b[D"],
]);

export function terminalInputForAccessoryKey(key: string): string {
  const input = terminalAccessoryInput.get(key);
  if (input === undefined) throw new Error(`unknown terminal accessory key: ${key}`);
  return input;
}

export function controlModifiedTerminalInput(data: string): string {
  // Cursor keys can arrive in normal or application-cursor mode.
  if (/^\x1b(?:\[|O)[ABCD]$/.test(data)) return `\x1b[1;5${data.at(-1)}`;
  if (data.length !== 1) return data;
  const code = data.toUpperCase().charCodeAt(0);
  if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
  if (data === "?") return "\x7f";
  if (data === " ") return "\x00";
  return data;
}

/** Shared Stimulus behavior for interactive terminal surfaces and their key bars. */
export function createTerminalKeyBarController(Controller: WorkspaceClientControllerConstructor) {
  abstract class TerminalKeyBarController extends Controller {
    static targets = ["control"];
    declare readonly controlTarget: HTMLButtonElement;
    protected abstract readonly accessoryViewer: ObservableTerminalViewer | undefined;
    private controlPending = false;

    protected transformAccessoryInput(data: string): string {
      if (!this.controlPending) return data;
      this.resetAccessoryKeys();
      return controlModifiedTerminalInput(data);
    }

    protected resetAccessoryKeys(): void { this.setControlPending(false); }

    private setControlPending(pending: boolean): void {
      this.controlPending = pending;
      this.controlTarget.setAttribute("aria-pressed", String(pending));
    }

    preserveTerminalFocus(event: MouseEvent): void {
      // Cancel focus transfer only: cancelling pointerdown can suppress iOS clicks.
      if (event.button === 0) event.preventDefault();
    }

    sendAccessoryKey(event: Event): void {
      if (!(event.currentTarget instanceof HTMLButtonElement)) throw new Error("terminal key action must come from a button");
      const key = event.currentTarget.dataset.terminalKey;
      if (!key) throw new Error("terminal key button is missing its key");
      this.element.querySelector(".gespenst__input")?.dispatchEvent(new Event("terminal-text-input:reset"));
      const viewer = this.accessoryViewer;
      if (key === "control") this.setControlPending(!this.controlPending);
      else viewer?.sendInput(this.transformAccessoryInput(terminalInputForAccessoryKey(key)));
      viewer?.setHistoryCursorHidden(false);
      viewer?.focus();
    }
  }
  return TerminalKeyBarController;
}
