import { changeLayout, focusLikelyOpensSoftwareKeyboard, isWorkspacePaneVisible, mobileComposerMediaQuery, type WorkspaceClientControllerConstructor } from "@agents-in-the-cloud/shared";

/** The composer may grow to this share of the space above the keyboard (or of the window). */
const composerMaxShare = 0.4;
/** A stacked composer may exceed that max (short screens) up to this share. */
const stackMaxShare = 0.5;
const longPressMs = 500;

/**
 * Composer visibility, height and draft indicator. Every change is applied in
 * one layout transaction so whatever sits above is pushed up in a single step.
 */
export function createAgentComposerController(Controller: WorkspaceClientControllerConstructor) {
  return class AgentComposerController extends Controller {
    static targets = ["opener"];
    declare readonly element: HTMLElement;
    declare readonly openerTarget: HTMLButtonElement;
    declare readonly hasOpenerTarget: boolean;
    private activeSelection = false;
    private pane!: HTMLElement;
    private longPress?: ReturnType<typeof setTimeout>;
    private suppressNextClick = false;

    connect(): void {
      this.pane = this.element.closest<HTMLElement>('[data-workspace-pane-role="agent"]')!;
      this.updateDraftIndicator();
      this.selected();
      this.autosize();
    }

    disconnect(): void {
      this.activeSelection = false;
      clearTimeout(this.longPress);
      this.blurInput();
    }

    private get composer(): HTMLElement | null {
      return this.element.querySelector<HTMLElement>(":scope > .composer");
    }

    private get input(): HTMLTextAreaElement | null {
      return this.element.querySelector<HTMLTextAreaElement>(":scope > .composer .composer-input");
    }

    private get isOpen(): boolean {
      return this.element.classList.contains("agent-composer-open");
    }

    private get mobile(): boolean {
      return window.matchMedia(mobileComposerMediaQuery).matches;
    }

    /** Programmatic focus cannot raise a soft keyboard, so touch devices wait for a tap. */
    private get focusesOnOpen(): boolean {
      return !this.mobile && !focusLikelyOpensSoftwareKeyboard();
    }

    private blurInput(): void {
      const active = document.activeElement;
      if (active instanceof HTMLElement && this.composer?.contains(active)) active.blur();
    }

    private setOpen(open: boolean): void {
      if (open === this.isOpen) return;
      changeLayout(() => {
        if (!open) this.blurInput();
        this.element.classList.toggle("agent-composer-open", open);
        this.autosize();
      });
    }

    selected(event?: Event): void {
      if (event && event.target !== this.pane) return;
      if (!isWorkspacePaneVisible(this.element) || this.activeSelection) return;
      this.activeSelection = true;
      const input = this.input;
      if (!input) return; // Ended CLI sessions are read-only.
      // Reading comes first on mobile; desktop starts ready to type.
      this.setOpen(!this.mobile);
      if (focusLikelyOpensSoftwareKeyboard()) this.blurInput();
      else if (document.hasFocus()) {
        if (this.isOpen) input.focus({ preventScroll: true });
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
      this.open();
    }

    open(): void {
      if (this.suppressNextClick) return;
      this.setOpen(true);
      if (this.focusesOnOpen) this.input!.focus({ preventScroll: true });
    }

    close(): void {
      this.setOpen(false);
    }

    /** A prompt was accepted for sending. On mobile the composer and keyboard go away at once. */
    sending(): void {
      if (this.mobile) this.close();
    }

    sent(): void {
      this.updateDraftIndicator();
      if (this.mobile) this.close();
    }

    /** Sending failed after the mobile composer closed: bring the draft and its error back. */
    failed(): void {
      if (this.mobile) this.setOpen(true);
    }

    /**
     * The text field can be short beside the buttons and quick launches: a tap
     * anywhere in the composer that isn't a control focuses it, caret at the end.
     */
    focusText(event: MouseEvent): void {
      const input = this.input;
      const target = event.target instanceof Element ? event.target : null;
      if (!input || input.inert || !target || !this.composer?.contains(target) || target === input) return;
      if (target.closest("button, a, input, select, textarea, label, summary, .agent-chip, .composer-footer, .agent-completion-menu-host")) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }

    /** A focused terminal takes the space; the composer collapses and keeps its draft. */
    focused(event: FocusEvent): void {
      if (event.target instanceof Element && event.target.closest(".observable-terminal-host") && this.isOpen) this.close();
    }

    draftChanged(event: Event): void {
      if (event.target !== this.input) return;
      this.autosize();
      this.updateDraftIndicator();
    }

    /** The keyboard arrangement changed: the maximum height depends on the space above it. */
    layout(): void {
      this.autosize();
    }

    /**
     * Sizes the text field: line by line up to the max, never below the buttons'
     * height. The buttons stack 1×4 whenever the text, at the stacked width,
     * fills that taller stack; the choice depends only on the content, so it can't oscillate.
     */
    autosize(): void {
      const input = this.input;
      const composer = this.composer;
      if (!input || !composer || !this.isOpen || !composer.checkVisibility()) return;
      const root = document.documentElement;
      const style = getComputedStyle(root);
      const keyboard = Number.parseFloat(style.getPropertyValue("--software-keyboard-inset") || "0")
        + Number.parseFloat(style.getPropertyValue("--software-keyboard-top") || "0");
      const available = root.clientHeight - keyboard;
      const maxComposer = Math.floor(available * composerMaxShare);
      const area = input.parentElement!;
      const buttons = area.querySelector<HTMLElement>(":scope > .composer-buttons")!;
      const launches = area.querySelector<HTMLElement>(":scope > .composer-quick-launches");
      const height = (element: HTMLElement | null): number => element?.checkVisibility() ? element.getBoundingClientRect().height : 0;
      // Everything but the input area: thumbnails, status, footer.
      const chrome = composer.getBoundingClientRect().height - area.getBoundingClientRect().height;
      const stacked = composer.classList.contains("composer-stacked");
      // Quick launches make way as soon as there is something written.
      const hadText = composer.classList.contains("composer-has-text");
      const hasText = /\S/.test(input.value);
      // Measure without letting the pane reflow: the input area keeps its size,
      // so the transcript above cannot clamp its scroll offset.
      const areaHeight = area.style.height;
      area.style.height = `${area.getBoundingClientRect().height}px`;
      const inline = input.style.height;
      const measure = (stack: boolean) => {
        composer.classList.toggle("composer-has-text", hasText);
        composer.classList.toggle("composer-stacked", stack);
        input.style.height = "0px";
        const content = Math.ceil(input.scrollHeight);
        const below = height(launches);
        // Buttons beside the text set its minimum; buttons floating above it (while typing) don't.
        const beside = getComputedStyle(buttons).position === "absolute" ? 0 : height(buttons);
        const minimum = Math.max(Number.parseFloat(getComputedStyle(input).minHeight) || 0, beside - below);
        const room = maxComposer - chrome - below;
        // Stack once the text fills the stack's height, or overflows the max. On a short
        // screen the stack may then exceed the max, but never half the space.
        const wanted = content >= room || content + below >= height(buttons) - 1;
        return { content, minimum, limit: Math.max(minimum, room), fits: wanted && chrome + height(buttons) <= available * stackMaxShare };
      };
      // While typing with a soft keyboard only send shows; there is nothing to stack.
      const stack = !root.classList.contains("software-keyboard-visible") && measure(true).fits;
      const layout = measure(stack);
      composer.classList.toggle("composer-stacked", stacked);
      composer.classList.toggle("composer-has-text", hadText);
      input.style.height = inline;
      area.style.height = areaHeight;
      const next = Math.max(layout.minimum, Math.min(layout.content, layout.limit));
      const overflow = layout.content > layout.limit ? "auto" : "hidden";
      const current = input.getBoundingClientRect().height;
      if (stack !== stacked || hasText !== hadText || Math.abs(next - current) >= 0.5 || input.style.overflowY !== overflow) {
        changeLayout(() => {
          composer.classList.toggle("composer-has-text", hasText);
          composer.classList.toggle("composer-stacked", stack);
          input.style.height = `${next}px`;
          input.style.overflowY = overflow;
        });
      }
      // A large paste or transcription lands with the caret in view.
      if (overflow === "auto" && document.activeElement === input && input.selectionEnd === input.value.length) input.scrollTop = input.scrollHeight;
    }

    private updateDraftIndicator(): void {
      if (!this.hasOpenerTarget) return;
      const input = this.input;
      const draft = Boolean(input?.value.trim() || this.composer?.querySelector(".agent-chip"));
      this.openerTarget.parentElement!.toggleAttribute("data-draft", draft);
    }

    // Holding open-composer opens it and starts dictation while the finger is still down.
    pressOpener(event: PointerEvent): void {
      if (event.button !== 0) return;
      clearTimeout(this.longPress);
      this.longPress = setTimeout(() => {
        this.longPress = undefined;
        this.suppressNextClick = true;
        this.setOpen(true);
        this.element.querySelector<HTMLButtonElement>(':scope > .composer [data-transcription-composer-target="button"]')!.click();
        // The release lands wherever the finger is now, possibly on a composer button.
        const swallow = (click: MouseEvent): void => { click.preventDefault(); click.stopImmediatePropagation(); };
        const release = (): void => {
          document.removeEventListener("pointerup", release, true);
          document.removeEventListener("pointercancel", release, true);
          document.addEventListener("click", swallow, true);
          setTimeout(() => {
            document.removeEventListener("click", swallow, true);
            this.suppressNextClick = false;
          }, 400);
        };
        document.addEventListener("pointerup", release, true);
        document.addEventListener("pointercancel", release, true);
      }, longPressMs);
    }

    releaseOpener(): void {
      clearTimeout(this.longPress);
      this.longPress = undefined;
    }

    suppressContextMenu(event: Event): void {
      event.preventDefault();
    }
  };
}
