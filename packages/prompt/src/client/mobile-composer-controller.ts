import { isWorkspacePaneVisible, type WorkspaceClientControllerConstructor } from "@atelier/shared";

/** Derive reading vs composing from the selected tab, never from a saved UI preference. */
export function createMobileComposerController(Controller: WorkspaceClientControllerConstructor) {
  return class MobileComposerController extends Controller {
    declare readonly element: HTMLElement;
    private activeSelection = false;
    private presentedUrl?: string;
    private readonly viewport = window.visualViewport;

    // The layout viewport stays full-height on mobile Safari when the keyboard
    // opens. Fit the built-in agent pane to the visible bottom instead of letting
    // focus pan its composer underneath the keyboard.
    private readonly fitViewport = (): void => {
      if (!this.element.classList.contains("agent-pane")) return;
      const viewport = this.viewport;
      if (!viewport) return;
      const bottom = viewport.offsetTop + viewport.height;
      const top = this.element.getBoundingClientRect().top;
      this.element.style.setProperty("--mobile-composer-viewport-height", `${Math.min(this.element.parentElement!.clientHeight, Math.max(0, bottom - top))}px`);
    };

    connect(): void {
      window.addEventListener("pagehide", this.acknowledgePresentation);
      this.viewport?.addEventListener("resize", this.fitViewport);
      this.viewport?.addEventListener("scroll", this.fitViewport);
      this.fitViewport();
      if (isWorkspacePaneVisible(this.element)) this.selected();
    }

    disconnect(): void {
      window.removeEventListener("pagehide", this.acknowledgePresentation);
      this.viewport?.removeEventListener("resize", this.fitViewport);
      this.viewport?.removeEventListener("scroll", this.fitViewport);
      this.element.style.removeProperty("--mobile-composer-viewport-height");
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
      if (!isWorkspacePaneVisible(this.element) || this.activeSelection) return;
      const input = this.element.querySelector<HTMLTextAreaElement>(".composer .composer-input");
      if (!input) return; // Ended CLI sessions have no composer.
      this.activeSelection = true;
      const hasDraft = Boolean(input.value || this.element.querySelector(".agent-chip"));
      const fresh = this.element.dataset.mobileComposerNew === "true";
      if (this.element.dataset.mobileComposerNew === "true") this.presentedUrl = this.element.dataset.mobileComposerPresentedUrl;
      const untouchedBuiltIn = this.element.classList.contains("agent-pane")
        && !this.element.querySelector(".agent-transcript-content .agent-item")
        && !this.element.querySelector('[data-agent-pane-target="sendStop"][data-agent-busy="true"]');
      const shouldOpen = hasDraft || fresh || untouchedBuiltIn;
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

    open(): void {
      this.element.classList.add("mobile-composer-open");
      this.element.querySelector<HTMLTextAreaElement>(".composer .composer-input")!.focus();
    }

    close(): void {
      const input = this.element.querySelector<HTMLTextAreaElement>(".composer .composer-input")!;
      if (document.activeElement === input) input.blur();
      this.element.classList.remove("mobile-composer-open");
    }

    submitted(event: CustomEvent<{ success: boolean }>): void {
      if (event.detail.success) this.close();
    }
  };
}
