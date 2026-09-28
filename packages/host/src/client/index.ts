import { Controller } from "@hotwired/stimulus";
import { atelierObservableTerminalTheme, createObservableTerminalViewer, observableWebSocketUrl, type ObservableTerminalViewer } from "@atelier/observable-terminal/client";
import type { WorkspaceClientModule } from "@atelier/shared";

class HostTerminalController extends Controller<HTMLElement> {
  static values = { url: String };
  static targets = ["host", "connectionStatus"];
  declare urlValue: string;
  declare readonly hostTarget: HTMLElement;
  declare readonly connectionStatusTarget: HTMLElement;
  private viewer?: ObservableTerminalViewer;
  private theme = new MutationObserver(() => this.viewer?.setTheme(atelierObservableTerminalTheme()));
  connect() {
    this.theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    const typography = getComputedStyle(this.hostTarget);
    this.viewer = createObservableTerminalViewer({ host: this.hostTarget, fontSize: Number.parseFloat(typography.fontSize), fontFamily: typography.fontFamily, websocketUrl: observableWebSocketUrl(this.urlValue), mode: "interactive", theme: atelierObservableTerminalTheme(), connectionStatus: this.connectionStatusTarget });
  }
  retry() { this.viewer?.reconnect(); }
  disconnect() { this.theme.disconnect(); this.viewer?.dispose(); this.viewer = undefined; }
}
class HostPanelController extends Controller<HTMLDialogElement> {
  closed() {
    // Remove terminal viewers and their attachments; detached System tmux owns the processes.
    this.element.remove();
  }
}
class HostDismissController extends Controller<HTMLElement> { dismiss() { this.element.remove(); } }
export const atelierClientModule: WorkspaceClientModule = {
  id: "host",
  install({ application }) {
    application.register("host-terminal", HostTerminalController);
    application.register("host-panel", HostPanelController);
    application.register("host-dismiss", HostDismissController);
  },
};
