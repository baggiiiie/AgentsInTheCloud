import { atelierObservableTerminalTheme, createObservableTerminalViewer, observableWebSocketUrl, TerminalViewportFit, type ObservableTerminalViewer } from "@atelier/observable-terminal/client";
import { CableTopics, composerSubmitKey, focusLikelyOpensSoftwareKeyboard, isWorkspacePaneVisible, setTextInputValue, workspaceFileOpenUrl, type CableSubscription, type WorkspaceClientModule } from "@atelier/shared";

export const atelierClientModule: WorkspaceClientModule = {
  id: "cli-agent",
  install({ application, Controller }) {
    application.register("cli-terminal", class extends Controller {
      static values = { url: String, workspaceId: String, conversationId: String, turnsChannel: String };
      static targets = ["terminal", "connectionStatus", "form", "input", "return", "turnFinished"];
      declare readonly element: HTMLElement;
      declare readonly urlValue: string;
      declare readonly workspaceIdValue: string;
      declare readonly conversationIdValue: string;
      declare readonly turnsChannelValue: string;
      declare readonly formTarget: HTMLFormElement;
      declare readonly inputTarget: HTMLTextAreaElement;
      declare readonly returnTarget: HTMLButtonElement;
      declare readonly hasFormTarget: boolean;
      declare readonly terminalTarget: HTMLElement;
      declare readonly connectionStatusTarget: HTMLElement;
      declare readonly hasTerminalTarget: boolean;
      private viewer?: ObservableTerminalViewer;
      private turns?: CableSubscription;
      private connected = false;
      private sending = false;
      private get draftKey(): string { return `atelier.cliComposerText:${JSON.stringify([this.workspaceIdValue, this.urlValue])}`; }
      private readonly inputChanged = (): void => { localStorage.setItem(this.draftKey, this.inputTarget.value); };
      private readonly terminalBlur = (event: FocusEvent): void => {
        if (event.relatedTarget instanceof Node && this.terminalTarget.contains(event.relatedTarget)) return;
        if (focusLikelyOpensSoftwareKeyboard()) this.showComposer();
      };
      private viewportHeight = 0;
      private keyboardWasOpen = false;
      private readonly keyboardViewportChanged = (): void => {
        if (!this.element.classList.contains("cli-raw-mode")) {
          this.viewportHeight = Math.max(this.viewportHeight, window.visualViewport!.height);
          return;
        }
        const height = window.visualViewport!.height;
        if (height < this.viewportHeight - 120) this.keyboardWasOpen = true;
        if (this.keyboardWasOpen && height >= this.viewportHeight - 80) {
          this.keyboardWasOpen = false;
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          this.showComposer();
        }
      };
      private touch?: { id: number; startX: number; startY: number; x: number; y: number; time: number; velocity: number; scrolling: boolean };
      private momentum = 0;
      private viewportFit!: TerminalViewportFit;
      private resize = new ResizeObserver(() => this.refresh());

      connect(): void {
        this.viewportFit = new TerminalViewportFit(this.element);
        this.viewportFit.connect();
        window.addEventListener("atelier:workspace-pane-visible", this.activate);
        this.viewportHeight = window.visualViewport!.height;
        window.visualViewport!.addEventListener("resize", this.keyboardViewportChanged);
        if (this.hasFormTarget) {
          setTextInputValue(this.inputTarget, localStorage.getItem(this.draftKey) ?? "");
          this.inputTarget.addEventListener("input", this.inputChanged);
          this.terminalTarget.addEventListener("focusout", this.terminalBlur);
        }
        this.activate();
      }
      private readonly activate = (): void => {
        if (isWorkspacePaneVisible(this.element)) this.start();
      };
      private start(): void {
        if (!this.hasTerminalTarget || this.viewer) return;
        this.resize.observe(this.terminalTarget);
        if (this.hasFormTarget) this.turns = window.AtelierCable!.subscribe(CableTopics.module(this.turnsChannelValue, this.workspaceIdValue, { conversationId: this.conversationIdValue }));
        this.viewer = createObservableTerminalViewer({
          host: this.terminalTarget, mode: "interactive", websocketUrl: observableWebSocketUrl(`${this.urlValue}/ws`), hideUnfocusedCursor: true,
          theme: atelierObservableTerminalTheme(),
          connectionStatus: this.connectionStatusTarget,
          onConnectionStateChange: (state) => { this.connected = state === "connected"; },
          onFileLink: ({ path, line, column }) => {
            const anchor = document.createElement("a");
            anchor.href = `${workspaceFileOpenUrl(this.workspaceIdValue, path, { line, column })}&existing=1`;
            anchor.dataset.turboStream = "true";
            anchor.hidden = true;
            this.element.append(anchor);
            anchor.click();
            anchor.remove();
          },
        });
      }
      disconnect(): void {
        this.viewportFit.disconnect();
        window.removeEventListener("atelier:workspace-pane-visible", this.activate);
        window.visualViewport!.removeEventListener("resize", this.keyboardViewportChanged);
        this.resize.disconnect();
        if (this.hasFormTarget) {
          this.inputTarget.removeEventListener("input", this.inputChanged);
          this.terminalTarget.removeEventListener("focusout", this.terminalBlur);
        }
        this.cancelTerminalTouch();
        this.turns?.unsubscribe();
        this.turns = undefined;
        this.viewer?.dispose();
        this.viewer = undefined;
      }
      turnFinishedTargetConnected(marker: HTMLElement): void {
        marker.remove();
        // Desktop only: focusing would open the software keyboard on touch devices.
        // Never take focus from another pane or control outside this agent.
        if (focusLikelyOpensSoftwareKeyboard() || !isWorkspacePaneVisible(this.element)) return;
        const active = document.activeElement;
        if (active && active !== document.body && !this.element.contains(active)) return;
        this.inputTarget.focus();
      }
      // Gespenst captures touch pointers as terminal mouse drags. Defer mouse input
      // until a completed tap so a swipe cannot click or select in the TUI.
      terminalPointer(event: PointerEvent): void {
        if (event.pointerType === "touch") event.stopPropagation();
      }
      startTerminalTouch(event: TouchEvent): void {
        this.stopMomentum();
        const point = event.touches[0];
        this.touch = event.touches.length === 1 && point
          ? { id: point.identifier, startX: point.screenX, startY: point.screenY, x: point.clientX, y: point.clientY, time: event.timeStamp, velocity: 0, scrolling: false }
          : undefined;
      }
      moveTerminalTouch(event: TouchEvent): void {
        const touch = this.touch;
        const point = event.touches[0];
        if (!touch || event.touches.length !== 1 || !point || point.identifier !== touch.id) { this.touch = undefined; return; }
        const dx = point.screenX - touch.startX;
        const dy = point.screenY - touch.startY;
        if (!touch.scrolling && Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx)) touch.scrolling = true;
        if (touch.scrolling) {
          event.preventDefault();
          const delta = touch.y - point.clientY;
          if (delta < 0) this.viewer?.setHistoryCursorHidden(true);
          this.viewer?.scrollTouch(delta, point.clientX, point.clientY);
          touch.velocity = delta / Math.max(1, event.timeStamp - touch.time);
        }
        touch.x = point.clientX;
        touch.y = point.clientY;
        touch.time = event.timeStamp;
      }
      cancelTerminalTouch(): void { this.touch = undefined; this.stopMomentum(); }
      finishTerminalTouch(event: TouchEvent): void {
        const touch = this.touch;
        this.touch = undefined;
        if (touch?.scrolling) {
          event.preventDefault();
          if (event.timeStamp - touch.time < 80 && Math.abs(touch.velocity) > 0.05) this.glide(touch.velocity, touch.x, touch.y);
          return;
        }
        const point = event.changedTouches[0];
        if (!touch || event.changedTouches.length !== 1 || !point || point.identifier !== touch.id
          || Math.hypot(point.screenX - touch.startX, point.screenY - touch.startY) > 10) return;
        event.preventDefault();
        const viewer = this.viewer;
        if (!viewer) return;
        const { clientX, clientY } = point;
        // Mobile browsers may cancel or retarget pointerup after a touch. Resolve
        // the completed tap directly against the painted cells instead.
        void viewer.activateFileLinkAt(clientX, clientY).then((opened) => {
          if (opened || this.viewer !== viewer) return;
          viewer.setHistoryCursorHidden(false);
          this.enterRawMode();
          viewer.focus();
          const pointer = new PointerEvent("pointerup", { clientX, clientY });
          viewer.dragPointer(pointer, "press", false);
          viewer.dragPointer(pointer, "release", false);
        });
      }
      private stopMomentum(): void { cancelAnimationFrame(this.momentum); this.momentum = 0; }
      private glide(velocity: number, x: number, y: number): void {
        let last = performance.now();
        const frame = (now: number): void => {
          const elapsed = Math.min(now - last, 40);
          last = now;
          velocity *= Math.exp(-elapsed / 180);
          if (Math.abs(velocity) < 0.02) { this.momentum = 0; return; }
          this.viewer?.scrollTouch(velocity * elapsed, x, y);
          this.momentum = requestAnimationFrame(frame);
        };
        this.momentum = requestAnimationFrame(frame);
      }
      resumeInput(): void { this.viewer?.setHistoryCursorHidden(false); }
      enterRawMode(): void {
        if (!this.hasFormTarget || !focusLikelyOpensSoftwareKeyboard()) return;
        this.element.classList.add("cli-raw-mode");
        this.returnTarget.hidden = false;
      }
      showComposer(): void {
        this.element.classList.remove("cli-raw-mode");
        this.keyboardWasOpen = false;
        if (this.hasFormTarget) this.returnTarget.hidden = true;
        this.viewer?.refresh();
      }
      inputKeydown(event: KeyboardEvent): void {
        if (this.element.querySelector(".agent-completion-menu-host:not([hidden])")) return;
        const submitKey = composerSubmitKey(event);
        if (!submitKey) return;
        event.preventDefault();
        if (submitKey === "software-keyboard") this.inputTarget.blur();
        this.formTarget.requestSubmit();
      }
      async submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (this.sending) return;
        const status = this.element.querySelector<HTMLElement>('[data-agent-attachments-target="status"]')!;
        const showError = (message: string): void => { status.textContent = message; status.hidden = false; };
        if (!this.connected || !this.viewer) { showError("Terminal disconnected. Reconnect and try again."); return; }
        const form = this.formTarget;
        const data = new FormData(form);
        if (!String(data.get("text") ?? "").trim() && !data.has("attachment")) {
          status.hidden = true;
          this.viewer.pressEnter();
          setTextInputValue(this.inputTarget, "");
          this.element.dispatchEvent(new Event("mobile-composer:sent"));
          return;
        }
        const draftText = this.inputTarget.value;
        this.sending = true;
        status.hidden = true;
        try {
          const response = await fetch(form.action, { method: "POST", body: data });
          if (!response.ok) throw new Error(await response.text());
          const text = await response.text();
          if (!this.connected) throw new Error("Terminal disconnected. Prompt retained; check the terminal before retrying.");
          this.viewer.paste(text);
          // The TUI handles bracketed paste asynchronously; let it finish before
          // submitting a real Enter key, rather than merging Enter into the paste.
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (!this.connected) throw new Error("Terminal disconnected after paste. Check the terminal before retrying.");
          this.viewer.pressEnter();
          this.element.dispatchEvent(new Event("mobile-composer:sent"));
          if (this.inputTarget.value === draftText) {
            setTextInputValue(this.inputTarget, "");
          }
          const sentIds = data.getAll("attachment").map(String);
          if (sentIds.length) {
            const consumed = await fetch(`${form.action}/consumed`, { method: "POST", body: data });
            if (!consumed.ok) throw new Error("Prompt sent, but attachments could not be cleared.");
            for (const chip of form.querySelectorAll(".agent-chip:not(.uploading)")) {
              if (sentIds.includes(chip.querySelector<HTMLInputElement>('input[name="attachment"]')!.value)) chip.remove();
            }
          }
        } catch (error) { showError(error instanceof Error ? error.message : String(error)); }
        finally { this.sending = false; }
      }
      retry(): void {
        this.viewer!.reconnect();
      }
      refresh(): void { this.viewer?.refresh(); }
      theme(): void { this.viewer?.setTheme(atelierObservableTerminalTheme()); }
    });
  },
};
