import { atelierObservableTerminalTheme, createObservableTerminalViewer, observableWebSocketUrl, type ObservableTerminalViewer } from "@atelier/observable-terminal/client";
import { composerSubmitKey, type AgentComposerSendPromptDetail, focusLikelyOpensSoftwareKeyboard, isTextEntry, isWorkspacePaneVisible, setTextInputValue, workspaceFileOpenUrl, type WorkspaceClientModule } from "@atelier/shared";

export const atelierClientModule: WorkspaceClientModule = {
  id: "cli-agent",
  install({ application, Controller }) {
    application.register("cli-terminal", class extends Controller {
      static values = { url: String, workspaceId: String };
      static targets = ["terminal", "connectionStatus", "form", "input", "transcript", "transcriptEnd"];
      declare readonly element: HTMLElement;
      declare readonly urlValue: string;
      declare readonly workspaceIdValue: string;
      declare readonly formTarget: HTMLFormElement;
      declare readonly inputTarget: HTMLTextAreaElement;
      declare readonly hasFormTarget: boolean;
      declare readonly terminalTarget: HTMLElement;
      declare readonly connectionStatusTarget: HTMLElement;
      declare readonly transcriptTarget: HTMLElement & { src: string };
      declare readonly transcriptEndTarget: HTMLButtonElement;
      declare readonly hasTranscriptTarget: boolean;
      declare readonly hasTerminalTarget: boolean;
      private viewer?: ObservableTerminalViewer;
      private connected = false;
      private sending = false;
      private get draftKey(): string { return `atelier.cliComposerText:${JSON.stringify([this.workspaceIdValue, this.urlValue])}`; }
      private readonly inputChanged = (): void => { localStorage.setItem(this.draftKey, this.inputTarget.value); };
      private touch?: { id: number; startX: number; startY: number; x: number; y: number; time: number; velocity: number; scrolling: boolean };
      private momentum = 0;
      private terminalHeight = 0;
      private paneWidth = 0;
      private keyboardOccluded = false;
      private resize = new ResizeObserver(() => this.refresh());

      connect(): void {
        window.addEventListener("atelier:workspace-pane-visible", this.activate);
        if (this.hasFormTarget) {
          setTextInputValue(this.inputTarget, localStorage.getItem(this.draftKey) ?? "");
          this.inputTarget.addEventListener("input", this.inputChanged);
        }
        this.activate();
      }
      private readonly activate = (): void => {
        if (isWorkspacePaneVisible(this.element)) this.start();
      };
      private start(): void {
        if (!this.hasTerminalTarget || this.viewer) return;
        this.resize.observe(this.element);
        this.resize.observe(this.terminalTarget.parentElement!);
        this.refresh();
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
        window.removeEventListener("atelier:workspace-pane-visible", this.activate);
        this.resize.disconnect();
        if (this.hasFormTarget) {
          this.inputTarget.removeEventListener("input", this.inputChanged);
        }
        this.cancelTerminalTouch();
        this.viewer?.dispose();
        this.viewer = undefined;
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
        // the completed tap directly against the painted cells instead. Start the
        // link lookup at the original location, before the terminal shifts.
        const bounds = this.terminalTarget.getBoundingClientRect();
        const link = viewer.activateFileLinkAt(clientX, clientY);
        // Focusing after the asynchronous lookup loses the touch gesture on
        // mobile Safari, so it cannot open the software keyboard.
        viewer.focus();
        void link.then((opened) => {
          if (opened || this.viewer !== viewer) return;
          viewer.setHistoryCursorHidden(false);
          const shifted = this.terminalTarget.getBoundingClientRect();
          const pointer = new PointerEvent("pointerup", {
            clientX: shifted.left + clientX - bounds.left,
            clientY: shifted.top + clientY - bounds.top,
          });
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
      showTranscript(): void {
        if (!this.hasTranscriptTarget) return;
        this.transcriptEndTarget.hidden = true;
        this.element.classList.add("cli-transcript-mode");
        this.transcriptTarget.src = `${this.transcriptTarget.dataset.url}?opened=${Date.now()}`;
      }
      private transcriptEndTop(): number {
        const transcript = this.transcriptTarget;
        const content = transcript.querySelector<HTMLElement>(".agent-transcript-content");
        if (!content) return 0;
        return Math.max(0, transcript.scrollTop + content.getBoundingClientRect().bottom - transcript.getBoundingClientRect().top - transcript.clientHeight + 24);
      }
      transcriptLoaded(event: Event): void {
        if (event.target !== this.transcriptTarget) return;
        requestAnimationFrame(() => { this.transcriptTarget.scrollTop = this.transcriptEndTop(); this.transcriptScrolled(); });
      }
      transcriptScrolled(): void {
        this.transcriptEndTarget.hidden = this.transcriptEndTop() - this.transcriptTarget.scrollTop <= 32;
      }
      scrollToTranscriptEnd(): void {
        this.transcriptTarget.scrollTo({ top: this.transcriptEndTop(), behavior: "smooth" });
      }
      showTerminal(): void {
        this.element.classList.remove("cli-transcript-mode");
        this.viewer?.refresh();
      }
      inputKeydown(event: KeyboardEvent): void {
        if (this.element.querySelector<HTMLElement>(".agent-completion-menu-host:not([hidden])")?.checkVisibility()) return;
        const submitKey = composerSubmitKey(event);
        if (!submitKey) return;
        event.preventDefault();
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
          this.element.dispatchEvent(new Event("agent-composer:sent"));
          return;
        }
        const draftText = this.inputTarget.value;
        this.sending = true;
        status.hidden = true;
        try {
          const delivered = await this.deliver(data);
          if (this.inputTarget.value === draftText) {
            setTextInputValue(this.inputTarget, "");
          }
          const sentIds = data.getAll("attachment").map(String);
          if (delivered && sentIds.length) {
            const consumed = await fetch(`${form.action}/consumed`, { method: "POST", body: data });
            if (!consumed.ok) throw new Error("Prompt sent, but attachments could not be cleared.");
            for (const chip of form.querySelectorAll(".agent-chip:not(.uploading)")) {
              if (sentIds.includes(chip.querySelector<HTMLInputElement>('input[name="attachment"]')!.value)) chip.remove();
            }
          }
          this.element.dispatchEvent(new Event("agent-composer:sent"));
        } catch (error) { showError(error instanceof Error ? error.message : String(error)); }
        finally { this.sending = false; }
      }
      async sendPrompt(event: CustomEvent<AgentComposerSendPromptDetail>): Promise<void> {
        if (this.sending) return;
        const status = this.element.querySelector<HTMLElement>('[data-agent-attachments-target="status"]')!;
        const data = new FormData();
        data.set("text", event.detail.text);
        data.set("attachmentDraft", String(new FormData(this.formTarget).get("attachmentDraft")));
        this.sending = true;
        status.hidden = true;
        try {
          await this.deliver(data);
          this.element.dispatchEvent(new Event("agent-composer:sent"));
        }
        catch (error) { status.textContent = error instanceof Error ? error.message : String(error); status.hidden = false; }
        finally { this.sending = false; }
      }
      // Returns false when the server handled the prompt itself without terminal input.
      private async deliver(data: FormData): Promise<boolean> {
        if (!this.connected || !this.viewer) throw new Error("Terminal disconnected. Reconnect and try again.");
        const response = await fetch(this.formTarget.action, { method: "POST", body: data });
        if (!response.ok) throw new Error(await response.text());
        if (response.status === 204) return false;
        const text = await response.text();
        if (!this.connected) throw new Error("Terminal disconnected. Prompt retained; check the terminal before retrying.");
        this.viewer.paste(text);
        // The TUI handles bracketed paste asynchronously; let it finish before
        // submitting a real Enter key, rather than merging Enter into the paste.
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!this.connected) throw new Error("Terminal disconnected after paste. Check the terminal before retrying.");
        this.viewer.pressEnter();
        return true;
      }
      retry(): void {
        this.viewer!.reconnect();
      }
      focus(): void { this.start(); this.viewer?.focus(); }
      refresh(): void {
        if (!this.hasTerminalTarget || !isWorkspacePaneVisible(this.element)) return;
        const viewport = window.visualViewport!;
        const width = this.element.clientWidth;
        // Text focus can belong to a hardware keyboard. Only an actually
        // occluded layout viewport freezes geometry; keep that state through
        // blur until the software keyboard's closing animation has finished.
        this.keyboardOccluded = focusLikelyOpensSoftwareKeyboard()
          && viewport.height < document.documentElement.clientHeight - 1
          && (isTextEntry(document.activeElement) || this.keyboardOccluded);
        // Retain the actual unobscured geometry, not pane height plus keyboard
        // occlusion: shell chrome also disappears while the keyboard is open.
        if (!this.terminalHeight || width !== this.paneWidth || !this.keyboardOccluded) {
          const stage = this.terminalTarget.parentElement!;
          this.terminalHeight = this.element.clientHeight - stage.offsetTop;
          this.paneWidth = width;
        }
        this.element.style.setProperty("--cli-terminal-height", `${this.terminalHeight}px`);
        this.viewer?.refresh();
      }
      theme(): void { this.viewer?.setTheme(atelierObservableTerminalTheme()); }
    });
  },
};
