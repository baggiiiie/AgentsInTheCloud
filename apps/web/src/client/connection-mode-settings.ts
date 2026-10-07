import { Controller } from "@hotwired/stimulus";

/** System events invalidate a server-rendered Turbo frame; no client-side markup. */
export class ConnectionModeSettingsController extends Controller<HTMLElement & { reload(): void }> {
  source?: EventSource;
  connect() {
    this.source = new EventSource("/settings/access/events");
    this.source.addEventListener("access", () => {
      if (this.element.hasAttribute("src")) this.element.reload();
      else this.element.setAttribute("src", "/settings/access");
    });
  }
  disconnect() { this.source?.close(); }
}
