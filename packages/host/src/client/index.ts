import { Controller } from "@hotwired/stimulus";
import { agentsInTheCloudObservableTerminalTheme, createObservableTerminalViewer, observableWebSocketUrl, type ObservableTerminalViewer } from "@agents-in-the-cloud/observable-terminal/client";
import type { WorkspaceClientModule } from "@agents-in-the-cloud/shared";

class HostTerminalController extends Controller<HTMLElement> {
  static values = { url: String };
  static targets = ["host", "connectionStatus"];
  declare urlValue: string;
  declare readonly hostTarget: HTMLElement;
  declare readonly connectionStatusTarget: HTMLElement;
  private viewer?: ObservableTerminalViewer;
  private theme = new MutationObserver(() => this.viewer?.setTheme(agentsInTheCloudObservableTerminalTheme()));
  connect() {
    this.theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    const typography = getComputedStyle(this.hostTarget);
    this.viewer = createObservableTerminalViewer({ host: this.hostTarget, fontSize: Number.parseFloat(typography.fontSize), fontFamily: typography.fontFamily, websocketUrl: observableWebSocketUrl(this.urlValue), mode: "interactive", theme: agentsInTheCloudObservableTerminalTheme(), connectionStatus: this.connectionStatusTarget });
  }
  retry() { this.viewer?.reconnect(); }
  disconnect() { this.theme.disconnect(); this.viewer?.dispose(); this.viewer = undefined; }
}
class HostDismissController extends Controller<HTMLElement> { dismiss() { this.element.remove(); } }
export const agentsInTheCloudClientModule: WorkspaceClientModule = {
  id: "host",
  install({ application }) {
    application.register("host-terminal", HostTerminalController);
    application.register("host-dismiss", HostDismissController);
  },
};
