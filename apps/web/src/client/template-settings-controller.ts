// @ts-expect-error Turbo ships no TypeScript declarations.
import { visit } from "@hotwired/turbo";
import { slidePageChange } from "@agents-in-the-cloud/design-system/page-slide/client";
import { resetButtonConfirmation } from "@agents-in-the-cloud/design-system/button-confirmation/client";
import { Controller } from "@hotwired/stimulus";
import type { ToggleChangeEvent } from "@agents-in-the-cloud/design-system/toggle/client";
import type { WorkspaceSelectionEvent } from "./workspace-residency.ts";
import { residencyController } from "./workspace-controller-registry.ts";

const templateSettingsPath = /^\/workspace-templates\/[^/]+\/settings$/;

/** Reopen a settings destination when browser history reaches it after the panel was closed. */
export function restoreTemplateSettingsDestination(): boolean {
  if (!templateSettingsPath.test(location.pathname)) return false;
  if (!document.querySelector('[data-controller~="template-settings"]')) visit(location.href, { action: "replace" });
  return true;
}

/** Browser-owned draft, focus and navigation behavior; all settings markup comes from the server. */
export class TemplateSettingsController extends Controller<HTMLElement> {
  static targets = ["form", "discard", "frame", "content"];
  declare readonly formTargets: HTMLFormElement[];
  declare readonly discardTarget: HTMLDialogElement;
  declare readonly frameTarget: HTMLElement;
  declare readonly contentTarget: HTMLElement;
  private readonly originals = new Map<HTMLFormElement, string>();
  private returnUrl = "/";
  private currentUrl = "";
  private opener?: HTMLElement;
  private pending?: () => void;
  private bypass = false;
  private submissions = 0;
  private focusRecord?: string;
  private restoring = false;
  private renders = 0;

  connect(): void {
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const workspaceId = residencyController()?.visibleWorkspaceId();
    this.returnUrl = location.pathname.includes("/workspace-templates/") ? workspaceId ? `/workspaces/${encodeURIComponent(workspaceId)}` : "/" : location.href;
    this.currentUrl = this.pageUrl();
    if (!templateSettingsPath.test(location.pathname)) history.pushState({}, "", this.currentUrl);
    else history.replaceState({}, "", this.currentUrl);
    const workspace = document.getElementById("workspace_detail")!;
    workspace.inert = true;
    workspace.setAttribute("aria-hidden", "true");
    document.dispatchEvent(new Event("agents-in-the-cloud:workspace-pane-hidden"));
    // Settings occupies the main destination on phones, rather than the workspace picker slide.
    this.element.closest(".fixed-shell-app")!.classList.remove("is-mobile-workspace-pane-open");
    document.addEventListener("click", this.navigate, true);
    document.addEventListener("turbo:before-visit", this.beforeVisit);
    document.addEventListener("turbo:before-render", this.beforeRender);
    this.element.addEventListener("turbo:before-frame-render", this.beforeFrameRender);
    document.addEventListener("turbo:before-stream-render", this.beforeStreamRender);
    document.addEventListener("workspace-residency:before-select", this.beforeWorkspaceSelection);
    window.addEventListener("beforeunload", this.beforeUnload);
    window.addEventListener("popstate", this.historyChanged, true);
    this.loaded();
  }

  disconnect(): void {
    document.removeEventListener("click", this.navigate, true);
    document.removeEventListener("turbo:before-visit", this.beforeVisit);
    document.removeEventListener("turbo:before-render", this.beforeRender);
    this.element.removeEventListener("turbo:before-frame-render", this.beforeFrameRender);
    document.removeEventListener("turbo:before-stream-render", this.beforeStreamRender);
    document.removeEventListener("workspace-residency:before-select", this.beforeWorkspaceSelection);
    window.removeEventListener("beforeunload", this.beforeUnload);
    window.removeEventListener("popstate", this.historyChanged, true);
    const replacement = document.getElementById(this.element.id);
    if (!replacement?.hasAttribute("data-controller")) {
      const workspace = document.getElementById("workspace_detail")!;
      workspace.inert = false;
      workspace.removeAttribute("aria-hidden");
      document.dispatchEvent(new Event("agents-in-the-cloud:workspace-pane-visible"));
      if (templateSettingsPath.test(location.pathname)) history.replaceState(history.state, "", this.returnUrl);
      if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    }
  }

  formTargetConnected(form: HTMLFormElement): void {
    // New-secret host defaults are initialized by their own Stimulus controller first.
    requestAnimationFrame(() => {
      if (!form.isConnected) return;
      this.originals.set(form, this.values(form));
      this.updateSave(form);
    });
  }
  formTargetDisconnected(form: HTMLFormElement): void { this.originals.delete(form); }

  private values(form: HTMLFormElement): string { return JSON.stringify([...new FormData(form).entries()]); }
  private dirty(): boolean { return this.formTargets.some(form => this.originals.has(form) && this.originals.get(form) !== this.values(form)); }
  private updateSave(form: HTMLFormElement): void {
    const button = form.querySelector<HTMLButtonElement>("[data-template-settings-save]")!;
    const original = this.originals.get(form);
    // New server-rendered forms stay disabled until their initial snapshot is captured.
    const unchanged = original === undefined || original === this.values(form);
    button.disabled = this.submissions > 0 || unchanged;
    // New edits restore the action immediately; the shared feedback timer never owns disabled state.
    if (!unchanged && !this.submissions) resetButtonConfirmation(button);
  }
  changed(event: Event): void {
    // SAFETY: These actions are bound only to inputs/toggles inside server-rendered forms.
    const form = (event.target as HTMLElement).closest("form")!;
    this.updateSave(form);
  }
  toggleChanged(event: ToggleChangeEvent): void {
    // SAFETY: These actions are bound only to inputs/toggles inside server-rendered forms.
    const form = (event.target as HTMLElement).closest("form")!;
    form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${CSS.escape(event.detail.name)}"]`)!.value = event.detail.value;
    if (event.detail.name === "optional" && form.hasAttribute("data-template-settings-new-secret")) form.querySelector<HTMLInputElement>('input[name="secretValue"]')!.required = event.detail.value === "false";
    this.updateSave(form);
  }

  submitting(event: Event): void {
    this.dismissError();
    this.submissions++;
    // SAFETY: Turbo submit events target the form whose lifecycle is being reported.
    const form = event.target as HTMLFormElement;
    form.inert = true;
    form.querySelector("[data-template-settings-save]")?.setAttribute("aria-busy", "true");
    this.formTargets.forEach(item => this.updateSave(item));
  }
  submitted(event: CustomEvent<{ success: boolean; fetchResponse?: { response: Response } }>): void {
    this.submissions--;
    // SAFETY: Turbo submit events target the submitting form.
    const form = event.target as HTMLFormElement;
    form.inert = false;
    form.querySelector("[data-template-settings-save]")?.removeAttribute("aria-busy");
    this.formTargets.forEach(form => this.updateSave(form));
    // Validation streams own their error rendering and focus. Transport failures have no stream.
    if (!event.detail.success && !event.detail.fetchResponse?.response.headers.get("Content-Type")?.startsWith("text/vnd.turbo-stream.html")) this.showRequestError();
  }
  dismissError(): void {
    this.element.querySelector("#template_settings_error")!.replaceChildren();
    this.element.querySelector<HTMLElement>("#template_settings_request_error")!.hidden = true;
  }
  frameMissing(event: Event): void {
    event.preventDefault();
    this.showRequestError();
  }
  private focusError(error: HTMLElement): void {
    error.scrollIntoView({ block: "nearest" });
    error.querySelector<HTMLButtonElement>("button")!.focus();
  }
  private showRequestError(): void {
    const error = this.element.querySelector<HTMLElement>("#template_settings_request_error")!;
    error.hidden = false;
    this.focusError(error);
  }
  private pageUrl(): string { return new URL(this.contentTarget.dataset.templateSettingsLocation!, location.href).href; }
  private markClean(): void { this.formTargets.forEach(form => this.originals.set(form, this.values(form))); }

  private loaded(): void {
    if (this.renders) return;
    const content = this.contentTarget;
    this.currentUrl = this.pageUrl();
    if (content.hasAttribute("data-template-settings-saved") || this.restoring) history.replaceState({}, "", this.currentUrl);
    else if (location.href !== this.currentUrl) history.pushState({}, "", this.currentUrl);
    this.restoring = false;
    const focusRecord = this.focusRecord;
    const record = focusRecord ? this.frameTarget.querySelector<HTMLElement>(`[data-template-settings-record="${CSS.escape(focusRecord)}"]`) : null;
    this.focusRecord = undefined;
    const saved = content.hasAttribute("data-template-settings-saved");
    const actions = saved ? this.frameTarget.querySelector<HTMLElement>("[data-template-settings-save-actions]") : null;
    const focus = actions ?? record ?? this.frameTarget.querySelector<HTMLElement>("[autofocus]") ?? this.frameTarget.querySelector<HTMLElement>("[data-template-settings-heading], .action-item");
    requestAnimationFrame(() => {
      if (focus?.isConnected) focus.focus({ preventScroll: true });
      if (actions?.isConnected) {
        actions.scrollIntoView({ block: "nearest" });
        content.removeAttribute("data-template-settings-saved");
      }
    });
  }

  private guard(action: () => void): void {
    if (this.submissions) return;
    if (!this.dirty()) { action(); return; }
    this.pending = action;
    this.discardTarget.showModal();
  }
  stay(event?: Event): void {
    event?.preventDefault();
    this.pending = undefined;
    this.discardTarget.close();
  }
  discard(): void {
    const action = this.pending!;
    this.pending = undefined;
    this.discardTarget.close();
    this.markClean();
    action();
  }
  close(): void { this.guard(() => this.leave()); }
  keydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented || this.discardTarget.open || this.element.querySelector(":popover-open")) return;
    event.preventDefault();
    this.close();
  }
  private leave(): void {
    history.replaceState(history.state, "", this.returnUrl);
    const host = document.createElement("div");
    host.id = this.element.id;
    this.element.replaceWith(host);
  }

  private readonly navigate = (event: MouseEvent): void => {
    if (this.bypass || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("a[href], [data-workspace-entry-id]") : null;
    if (!target || target.closest("dialog")) return;
    const inside = this.element.contains(target);
    // Normal links opening another tab do not abandon the current draft.
    if (target instanceof HTMLAnchorElement && target.target === "_blank") return;
    if (inside) this.focusRecord = target.dataset.templateSettingsFocus;
    if (inside && target.hasAttribute("data-template-settings-cancel") && !this.submissions) {
      this.markClean();
      return;
    }
    const action = (): void => {
      if (!inside) this.leave();
      this.bypass = true;
      target.click();
      this.bypass = false;
    };
    if (this.submissions || this.dirty() || !inside) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.guard(action);
    }
  };
  private readonly beforeWorkspaceSelection = (event: Event): void => {
    if (!this.element.isConnected) return;
    event.preventDefault();
    // SAFETY: Workspace residency owns the event and its continuation contract.
    const selection = event as WorkspaceSelectionEvent;
    this.guard(() => { this.leave(); void selection.detail.resume(); });
  };
  private readonly beforeVisit = (event: Event): void => {
    if (this.bypass || !this.dirty()) return;
    event.preventDefault();
    // SAFETY: turbo:before-visit supplies its browser destination in detail.url.
    const url = (event as CustomEvent<{ url: string }>).detail.url;
    this.guard(() => { this.leave(); visit(url); });
  };
  private readonly beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.dirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  private restore(destination: string): void {
    if (new URL(destination).pathname === new URL(this.currentUrl).pathname) {
      this.restoring = true;
      this.frameTarget.setAttribute("src", destination);
    } else {
      this.leave();
      visit(destination, { action: "replace" });
    }
  }
  private async renderPage(nextFrame: HTMLElement, render: () => void | Promise<void>): Promise<void> {
    const previousDepth = Number(this.contentTarget.dataset.templateSettingsDepth);
    const nextDepth = Number(nextFrame.querySelector<HTMLElement>("[data-template-settings-depth]")!.dataset.templateSettingsDepth);
    const saved = nextFrame.querySelector("[data-template-settings-saved]") !== null;
    const scrollTop = this.frameTarget.querySelector<HTMLElement>(".panel__body")!.scrollTop;
    this.renders++;
    try {
      // Same-page updates do not slide. Focus and acknowledgement follow completed motion.
      if (previousDepth === nextDepth) {
        await render();
        if (saved) this.frameTarget.querySelector<HTMLElement>(".panel__body")!.scrollTop = scrollTop;
      }
      else await slidePageChange(
        () => this.frameTarget.querySelector<HTMLElement>(".panel__body")!,
        async () => { await render(); return this.frameTarget.querySelector<HTMLElement>(".panel__body")!; },
        nextDepth > previousDepth ? "forward" : "back",
      );
    } finally { this.renders--; }
    if (this.element.isConnected) this.loaded();
  }
  private readonly beforeFrameRender = (event: Event): void => {
    if (event.target !== this.frameTarget) return;
    // SAFETY: Turbo owns the incoming frame and its awaited replacement callback.
    const { detail } = event as CustomEvent<{
      newFrame: HTMLElement;
      render(current: HTMLElement, incoming: HTMLElement): void | Promise<void>;
    }>;
    const render = detail.render;
    detail.render = (current, incoming) => this.renderPage(detail.newFrame, () => render(current, incoming));
  };
  private readonly beforeStreamRender = (event: Event): void => {
    // SAFETY: Turbo exposes the server-rendered stream template and awaited renderer.
    const { detail } = event as CustomEvent<{
      newStream: HTMLElement & { templateElement: HTMLTemplateElement };
      render(stream: HTMLElement): Promise<void>;
    }>;
    const stream = detail.newStream;
    if (stream.getAttribute("target") === "template_settings_error") {
      const render = detail.render;
      detail.render = async stream => {
        await render(stream);
        if (this.element.isConnected) this.focusError(this.element.querySelector<HTMLElement>("#template_settings_error")!);
      };
      return;
    }
    if (stream.getAttribute("action") !== "replace" || stream.getAttribute("target") !== this.frameTarget.id) return;
    const nextFrame = stream.templateElement.content.querySelector<HTMLElement>("turbo-frame")!;
    const render = detail.render;
    detail.render = stream => this.renderPage(nextFrame, () => render(stream));
  };

  private readonly beforeRender = (event: Event): void => {
    if (!this.dirty()) return;
    event.preventDefault();
    // SAFETY: Turbo's cancelable render event supplies the suspended render's resume callback.
    const resume = (event as CustomEvent<{ resume(): void }>).detail.resume;
    if (!this.discardTarget.open) this.guard(resume);
  };
  private readonly historyChanged = (event: PopStateEvent): void => {
    const destination = location.href;
    if (this.dirty()) {
      event.stopImmediatePropagation();
      history.replaceState({}, "", this.currentUrl);
      this.guard(() => this.restore(destination));
    } else if (new URL(destination).pathname === new URL(this.currentUrl).pathname) {
      event.stopImmediatePropagation();
      this.restore(destination);
    } else {
      this.returnUrl = destination;
      this.leave();
    }
  };
}
