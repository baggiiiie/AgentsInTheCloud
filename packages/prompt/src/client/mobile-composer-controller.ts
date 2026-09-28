import { isWorkspacePaneVisible, type WorkspaceClientControllerConstructor } from "@atelier/shared";

/** Derive reading vs composing from the selected tab, never from a saved UI preference. */
export function createMobileComposerController(Controller: WorkspaceClientControllerConstructor) {
  return class MobileComposerController extends Controller {
    declare readonly element: HTMLElement;
    private activeSelection = false;
    private presentedUrl?: string;
    private readonly viewport = window.visualViewport;
    private composerResizeObserver?: ResizeObserver;
    private fitFrame = 0;

    // The layout viewport stays full-height on mobile Safari when the keyboard
    // opens. Fit the pane to the visible bottom, then account for the composer
    // itself being taller than that space (as a manual upward pan would).
    private readonly fitViewport = (): void => {
      if (!this.element.classList.contains("agent-pane") || !this.viewport) return;
      cancelAnimationFrame(this.fitFrame);
      this.fitFrame = requestAnimationFrame(() => {
        const parent = this.element.parentElement!;
        const bottom = this.viewport!.offsetTop + this.viewport!.height;
        const height = Math.min(parent.clientHeight, Math.max(0, bottom - parent.getBoundingClientRect().top));
        this.element.style.setProperty("--mobile-composer-viewport-height", `${height}px`);
        const keyboardOpen = document.documentElement.classList.contains("software-keyboard-visible") && this.element.classList.contains("mobile-composer-open");
        const composerHeight = this.element.querySelector<HTMLElement>(".agent-pane-composer")?.offsetHeight ?? 0;
        this.element.style.setProperty("--mobile-composer-offset", `${keyboardOpen ? -Math.max(0, composerHeight - height) : 0}px`);
      });
    };

    connect(): void {
      window.addEventListener("pagehide", this.acknowledgePresentation);
      this.viewport?.addEventListener("resize", this.fitViewport);
      this.viewport?.addEventListener("scroll", this.fitViewport);
      const composer = this.element.querySelector<HTMLElement>(".agent-pane-composer");
      if (composer) {
        this.composerResizeObserver = new ResizeObserver(this.fitViewport);
        this.composerResizeObserver.observe(composer);
      }
      this.fitViewport();
      if (isWorkspacePaneVisible(this.element)) this.selected();
    }

    disconnect(): void {
      window.removeEventListener("pagehide", this.acknowledgePresentation);
      this.viewport?.removeEventListener("resize", this.fitViewport);
      this.viewport?.removeEventListener("scroll", this.fitViewport);
      this.composerResizeObserver?.disconnect();
      cancelAnimationFrame(this.fitFrame);
      this.element.style.removeProperty("--mobile-composer-viewport-height");
      this.element.style.removeProperty("--mobile-composer-offset");
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
      this.fitViewport();
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
      this.fitViewport();
      this.element.querySelector<HTMLTextAreaElement>(".composer .composer-input")!.focus();
    }

    close(): void {
      const input = this.element.querySelector<HTMLTextAreaElement>(".composer .composer-input")!;
      if (document.activeElement === input) input.blur();
      this.element.classList.remove("mobile-composer-open");
      this.fitViewport();
    }

    submitted(event: CustomEvent<{ success: boolean }>): void {
      if (event.detail.success) this.close();
    }
  };
}
