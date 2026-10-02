import { focusLikelyOpensSoftwareKeyboard, isWorkspacePaneVisible, phoneLayoutMediaQuery, type WorkspaceClientControllerConstructor } from "@agents-in-the-cloud/shared";

/** Composer visibility is independent of input focus and the software keyboard. */
export function createAgentComposerController(Controller: WorkspaceClientControllerConstructor) {
  return class AgentComposerController extends Controller {
    declare readonly element: HTMLElement;
    private activeSelection = false;
    private pane!: HTMLElement;

    connect(): void {
      this.pane = this.element.closest<HTMLElement>('[data-workspace-pane-role="agent"]')!;
      this.selected();
    }

    disconnect(): void {
      this.activeSelection = false;
      this.blurInput();
    }

    private get input(): HTMLTextAreaElement | null {
      return this.element.querySelector<HTMLTextAreaElement>(".composer .composer-input");
    }

    private get staysOpen(): boolean {
      return this.element.classList.contains("agent-pane") && !window.matchMedia(phoneLayoutMediaQuery).matches;
    }

    private blurInput(): void {
      const active = document.activeElement;
      if (active instanceof HTMLElement && this.element.contains(active)) active.blur();
    }

    selected(event?: Event): void {
      if (event && event.target !== this.pane) return;
      if (!isWorkspacePaneVisible(this.element) || this.activeSelection) return;
      this.activeSelection = true;
      const input = this.input;
      if (!input) return; // Ended CLI sessions are read-only.
      const hasDraft = Boolean(input.value.trim() || this.element.querySelector(".agent-chip"));
      const open = this.staysOpen || hasDraft;
      this.element.classList.toggle("agent-composer-open", open);
      if (focusLikelyOpensSoftwareKeyboard()) this.blurInput();
      else if (document.hasFocus()) {
        if (open) input.focus({ preventScroll: true });
        else this.element.dispatchEvent(new Event("agents-in-the-cloud:workspace-agent-focus"));
      }
    }

    hidden(event: Event): void {
      if (event.target !== this.pane) return;
      // Live-surface replacement briefly hides and re-shows the same pane.
      setTimeout(() => {
        if (this.element.isConnected && isWorkspacePaneVisible(this.element)) return;
        this.activeSelection = false;
        this.blurInput();
      }, 0);
    }

    reveal(): void {
      if (!this.element.classList.contains("agent-composer-open")) this.open();
    }

    open(): void {
      this.element.classList.add("agent-composer-open");
      if (!focusLikelyOpensSoftwareKeyboard()) this.input!.focus({ preventScroll: true });
    }

    close(): void {
      const active = document.activeElement;
      if (active instanceof HTMLElement && this.element.querySelector(".composer")?.contains(active)) active.blur();
      this.element.classList.remove("agent-composer-open");
    }

    sent(): void {
      if (this.staysOpen) return;
      this.close();
      if (!focusLikelyOpensSoftwareKeyboard() && isWorkspacePaneVisible(this.element) && document.hasFocus()) {
        this.element.dispatchEvent(new Event("agents-in-the-cloud:workspace-agent-focus"));
      }
    }
  };
}
