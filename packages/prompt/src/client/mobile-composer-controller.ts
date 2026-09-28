import { isWorkspacePaneVisible, type WorkspaceClientControllerConstructor } from "@atelier/shared";

/** Keep CLI reading/composing state per conversation for this browser-tab session. */
export function createMobileComposerController(Controller: WorkspaceClientControllerConstructor) {
  return class MobileComposerController extends Controller {
    declare readonly element: HTMLElement;
    private activeSelection = false;
    private presentedUrl?: string;

    private get storageKey(): string {
      // The server-rendered pane ID includes both workspace and conversation IDs.
      return `atelier:composer:${this.element.id}`;
    }

    connect(): void {
      window.addEventListener("pagehide", this.acknowledgePresentation);
      if (isWorkspacePaneVisible(this.element)) this.selected();
    }

    disconnect(): void {
      window.removeEventListener("pagehide", this.acknowledgePresentation);
    }

    private readonly acknowledgePresentation = (): void => {
      if (!this.presentedUrl) return;
      void fetch(this.presentedUrl, { method: "POST", keepalive: true });
      this.presentedUrl = undefined;
      delete this.element.dataset.mobileComposerNew;
    };

    selected(event?: Event): void {
      const pane = this.element.closest<HTMLElement>('[data-workspace-pane-role="agent"]')!;
      if (event && event.target !== pane) return;
      if (this.element.classList.contains("agent-pane")) return;
      if (!isWorkspacePaneVisible(this.element) || this.activeSelection) return;
      const input = this.element.querySelector<HTMLTextAreaElement>(".composer .composer-input");
      if (!input) return; // Ended CLI sessions have no composer.
      this.activeSelection = true;
      const hasDraft = Boolean(input.value || this.element.querySelector(".agent-chip"));
      const fresh = this.element.dataset.mobileComposerNew === "true";
      if (this.element.dataset.mobileComposerNew === "true") this.presentedUrl = this.element.dataset.mobileComposerPresentedUrl;
      const saved = sessionStorage.getItem(this.storageKey);
      const shouldOpen = saved === "open" || (saved !== "closed" && (hasDraft || fresh));
      sessionStorage.setItem(this.storageKey, shouldOpen ? "open" : "closed");
      this.element.classList.toggle("mobile-composer-open", shouldOpen);
      if (shouldOpen && window.matchMedia("(max-width: 700px)").matches && document.hasFocus()) input.focus();
    }

    hidden(event: Event): void {
      if (event.target !== this.element.closest('[data-workspace-pane-role="agent"]')) return;
      // Live-surface replacement briefly hides and re-shows the same pane. Only
      // leaving it for real ends this first selection.
      setTimeout(() => {
        if (this.element.isConnected && isWorkspacePaneVisible(this.element)) return;
        this.activeSelection = false;
        this.acknowledgePresentation();
      }, 0);
    }

    reveal(): void {
      if (!this.element.classList.contains("mobile-composer-open")) this.open();
    }

    open(): void {
      sessionStorage.setItem(this.storageKey, "open");
      this.element.classList.add("mobile-composer-open");
      this.element.querySelector<HTMLTextAreaElement>(".composer .composer-input")!.focus();
    }

    close(): void {
      sessionStorage.setItem(this.storageKey, "closed");
      const input = this.element.querySelector<HTMLTextAreaElement>(".composer .composer-input")!;
      if (document.activeElement === input) input.blur();
      this.element.classList.remove("mobile-composer-open");
    }

  };
}
