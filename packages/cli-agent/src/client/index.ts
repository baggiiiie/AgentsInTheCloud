import { atelierObservableTerminalTheme, createObservableTerminalViewer, observableWebSocketUrl, TerminalViewportFit, type ObservableTerminalViewer } from "@atelier/observable-terminal/client";
import { isWorkspacePaneVisible, workspaceFileOpenUrl, type WorkspaceClientModule } from "@atelier/shared";

export const atelierClientModule: WorkspaceClientModule = {
  id: "cli-agent",
  install({ application, Controller }) {
    application.register("cli-terminal", class extends Controller {
      static values = { url: String, workspaceId: String };
      static targets = ["terminal", "connectionStatus"];
      declare readonly element: HTMLElement;
      declare readonly urlValue: string;
      declare readonly workspaceIdValue: string;
      declare readonly terminalTarget: HTMLElement;
      declare readonly connectionStatusTarget: HTMLElement;
      declare readonly hasTerminalTarget: boolean;
      private viewer?: ObservableTerminalViewer;
      private touch?: { id: number; startX: number; startY: number; x: number; y: number; time: number; velocity: number; scrolling: boolean };
      private momentum = 0;
      private viewportFit!: TerminalViewportFit;
      private resize = new ResizeObserver(() => this.refresh());

      connect(): void {
        this.viewportFit = new TerminalViewportFit(this.element);
        this.viewportFit.connect();
        window.addEventListener("atelier:workspace-pane-visible", this.activate);
        this.activate();
      }
      private readonly activate = (): void => {
        if (isWorkspacePaneVisible(this.element)) this.start();
      };
      private start(): void {
        if (!this.hasTerminalTarget || this.viewer) return;
        this.resize.observe(this.terminalTarget);
        this.viewer = createObservableTerminalViewer({
          host: this.terminalTarget, mode: "interactive", websocketUrl: observableWebSocketUrl(`${this.urlValue}/ws`),
          theme: atelierObservableTerminalTheme(),
          onConnect: () => this.setConnected(true),
          onDisconnect: () => this.setConnected(false),
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
        this.resize.disconnect();
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
        this.viewer?.setHistoryCursorHidden(false);
        this.viewer?.focus();
        const pointer = new PointerEvent("pointerup", { clientX: point.clientX, clientY: point.clientY });
        this.viewer?.dragPointer(pointer, "press", false);
        this.viewer?.dragPointer(pointer, "release", false);
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
      private setConnected(connected: boolean): void {
        this.connectionStatusTarget.hidden = connected;
        this.element.setAttribute("data-transcription-composer-unavailable-value", String(!connected));
      }
      dictate(event: CustomEvent<{ text: string }>): void {
        // Treat recognized text as a paste, never as terminal control keys or Enter.
        this.resumeInput();
        this.viewer!.paste(event.detail.text.replace(/[\x00-\x1f\x7f-\x9f]/g, " "));
      }
      focus(): void { this.resumeInput(); this.viewer?.focus(); }
      retry(): void {
        this.viewer!.reconnect();
      }
      refresh(): void { this.viewer?.refresh(); }
      theme(): void { this.viewer?.setTheme(atelierObservableTerminalTheme()); }
    });
  },
};
