import { Controller } from "@hotwired/stimulus";
import { setToggleValue } from "@atelier/design-system/toggle/client";
import { projectSecretAllowsPath } from "@atelier/projects/secret-path-policy";

/** New-secret defaults follow the host until the user explicitly picks a permission. */
export class ProjectSecretPathController extends Controller<HTMLFormElement> {
  static targets = ["host", "permission", "toggle"];
  declare readonly hostTarget: HTMLInputElement;
  declare readonly permissionTarget: HTMLInputElement;
  declare readonly toggleTarget: HTMLElement;
  private chosen = false;

  connect(): void { this.useDefault(); }

  useDefault(): void {
    if (this.chosen) return;
    const value = String(projectSecretAllowsPath({ hostPattern: this.hostTarget.value }));
    this.permissionTarget.value = value;
    setToggleValue(this.toggleTarget, value);
  }

  choose(event: Event): void {
    // The design-system toggle emits change for keyboard/selection changes,
    // but a click on the already-selected choice is also an explicit decision.
    if (event.type === "click" && !(event.target instanceof Element && event.target.closest('button[name="allowInPath"]'))) return;
    this.chosen = true;
  }
}
