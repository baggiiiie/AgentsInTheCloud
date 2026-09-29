import { focusLikelyOpensSoftwareKeyboard, isWorkspacePaneVisible, type WorkspaceClientControllerConstructor } from "@atelier/shared";

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
      const builtin = this.element.classList.contains("agent-pane");
      const hasDraft = Boolean(input.value.trim() || this.element.querySelector(".agent-chip"));
      this.element.classList.toggle("agent-composer-open", builtin || hasDraft);
      if (focusLikelyOpensSoftwareKeyboard()) this.blurInput();
      else if (document.hasFocus()) {
        if (builtin || hasDraft) input.focus({ preventScroll: true });
        else this.element.dispatchEvent(new Event("atelier:workspace-agent-focus"));
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
      this.input!.focus({ preventScroll: true });
    }

    close(): void {
      const active = document.activeElement;
      if (active instanceof HTMLElement && this.element.querySelector(".composer")?.contains(active)) active.blur();
      this.element.classList.remove("agent-composer-open");
    }

    sent(): void {
      this.close();
      if (!focusLikelyOpensSoftwareKeyboard() && isWorkspacePaneVisible(this.element) && document.hasFocus()) {
        this.element.dispatchEvent(new Event("atelier:workspace-agent-focus"));
      }
    }
  };
}
