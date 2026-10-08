// @ts-expect-error Turbo ships no TypeScript declarations.
import { visit } from "@hotwired/turbo";
import { resetButtonConfirmation } from "@agents-in-the-cloud/design-system/button-confirmation/client";
import { Controller } from "@hotwired/stimulus";
import { setToggleValue, type ToggleChangeEvent } from "@agents-in-the-cloud/design-system/toggle/client";
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
  static targets = ["form", "discard", "frame", "content", "developer", "colorPicker"];
  declare readonly developerTargets: HTMLElement[];
  private altPressed = false;
  declare readonly formTargets: HTMLFormElement[];
  declare readonly discardTarget: HTMLDialogElement;
  declare readonly frameTarget: HTMLElement;
  declare readonly contentTarget: HTMLElement;
  private readonly originals = new Map<HTMLFormElement, string>();
  private readonly preservedOriginals = new Map<string, string>();
  private returnUrl = "/";
  private currentUrl = "";
  private opener?: HTMLElement;
  private pending?: () => void;
  private bypass = false;
  private submissions = 0;
  private restoring = false;
  private renders = 0;
  private readonly autosaves = new Map<HTMLFormElement, ReturnType<typeof setTimeout>>();
  private submittedFocus?: { key: string; name: string; start: number | null; end: number | null };

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
    for (const timer of this.autosaves.values()) clearTimeout(timer);
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

  developerTargetConnected(target: HTMLElement): void { target.hidden = !this.altPressed; }
  developerKey(event: KeyboardEvent | FocusEvent): void {
    this.altPressed = event instanceof KeyboardEvent && event.altKey;
    for (const target of this.developerTargets) target.hidden = !this.altPressed;
  }

  formTargetConnected(form: HTMLFormElement): void {
    // New-secret host defaults are initialized by their own Stimulus controller first.
    requestAnimationFrame(() => {
      if (!form.isConnected) return;
      const key = form.dataset.templateSettingsFormKey!;
      this.originals.set(form, this.preservedOriginals.has(key) ? this.preservedOriginals.get(key)! : this.values(form));
      this.preservedOriginals.delete(key);
      this.updateSave(form);
    });
  }
  formTargetDisconnected(form: HTMLFormElement): void {
    this.originals.delete(form);
    clearTimeout(this.autosaves.get(form));
    this.autosaves.delete(form);
  }

  private values(form: HTMLFormElement): string { return JSON.stringify([...new FormData(form).entries()]); }
  private dirty(): boolean { return this.formTargets.some(form => this.originals.has(form) && this.originals.get(form) !== this.values(form)); }
  private updateSave(form: HTMLFormElement): void {
    const button = form.querySelector<HTMLButtonElement>("[data-template-settings-save]")!;
    const original = this.originals.get(form);
    // New server-rendered forms stay disabled until their initial snapshot is captured.
    const unchanged = original === undefined || original === this.values(form);
    button.disabled = this.submissions > 0 || unchanged || form.dataset.templateSettingsAvailable === "false";
    // New edits restore the action immediately; the shared feedback timer never owns disabled state.
    if (!unchanged && !this.submissions) resetButtonConfirmation(button);
  }
  colorPickerTargetConnected(picker: HTMLInputElement): void {
    const color = picker.closest("form")!.querySelector<HTMLInputElement>('input[name="swatchColor"]')!.value;
    // Canvas converts the existing OKLCH swatch to the native picker's sRGB hex format.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = color || picker.dataset.defaultColor!;
    picker.parentElement!.querySelector<HTMLElement>(".workspace-template-icon")!.style.setProperty("--workspace-template-swatch", color || picker.dataset.defaultColor!);
    context.fillRect(0, 0, 1, 1);
    picker.value = "#" + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => channel.toString(16).padStart(2, "0")).join("");
  }
  colorChanged(event: Event): void {
    // Wait for the native picker to commit so autosave does not interrupt color browsing.
    if (event.type === "input") { event.stopPropagation(); return; }
    // SAFETY: This change action is bound only to the native color input.
    const picker = event.target as HTMLInputElement;
    picker.closest("form")!.querySelector<HTMLInputElement>('input[name="swatchColor"]')!.value = picker.value;
    picker.parentElement!.querySelector<HTMLElement>(".workspace-template-icon")!.style.setProperty("--workspace-template-swatch", picker.value);
    this.changed(event);
  }
  changed(event: Event): void {
    // SAFETY: These actions are bound only to inputs/toggles inside server-rendered forms.
    const form = (event.target as HTMLElement).closest("form")!;
    this.updateSave(form);
    this.queueAutosave(form);
  }
  toggleChanged(event: ToggleChangeEvent): void {
    // SAFETY: These actions are bound only to inputs/toggles inside server-rendered forms.
    const form = (event.target as HTMLElement).closest("form")!;
    form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${CSS.escape(event.detail.name)}"]`)!.value = event.detail.value;
    this.updateSave(form);
    this.queueAutosave(form);
  }
  private queueAutosave(form: HTMLFormElement): void {
    if (!form.hasAttribute("data-template-settings-autosave")) return;
    clearTimeout(this.autosaves.get(form));
    this.autosaves.set(form, setTimeout(() => {
      this.autosaves.delete(form);
      const button = form.querySelector<HTMLButtonElement>("[data-template-settings-save]")!;
      if (!form.isConnected || this.discardTarget.open || button.disabled || !form.checkValidity()) return;
      form.requestSubmit(button);
    }, 600));
  }
  reset(event: Event): void {
    // SAFETY: Reset actions are bound to buttons inside editor forms.
    const form = (event.target as HTMLElement).closest("form")!;
    form.reset();
    for (const picker of form.querySelectorAll<HTMLInputElement>('input[type="color"]')) this.colorPickerTargetConnected(picker);
    for (const toggle of form.querySelectorAll<HTMLElement>('[data-controller~="toggle"]')) {
      const name = toggle.querySelector<HTMLButtonElement>("button[name]")!.name;
      setToggleValue(toggle, form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${CSS.escape(name)}"]`)!.value);
    }
    this.updateSave(form);
    form.closest("details")?.querySelector("summary")?.focus();
  }

  submitting(event: Event): void {
    this.dismissError();
    this.submissions++;
    // SAFETY: Turbo submit events target the form whose lifecycle is being reported.
    const form = event.target as HTMLFormElement;
    const active = document.activeElement;
    this.submittedFocus = form.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) ? { key: form.dataset.templateSettingsFormKey!, name: active.name, start: active.selectionStart, end: active.selectionEnd } : undefined;
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
    this.formTargets.forEach(item => {
      this.updateSave(item);
      if (item !== form || event.detail.success) this.queueAutosave(item);
    });
    if (!event.detail.success) this.submittedFocus = undefined;
    if (!event.detail.success && form.hasAttribute("data-template-settings-autosave")) form.querySelector<HTMLElement>("[data-template-settings-save-actions]")!.hidden = false;
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
    if (content.hasAttribute("data-template-settings-submitted-path") || this.restoring) history.replaceState({}, "", this.currentUrl);
    else if (location.href !== this.currentUrl) history.pushState({}, "", this.currentUrl);
    this.restoring = false;
    const key = content.dataset.templateSettingsFocus;
    const record = key ? this.frameTarget.querySelector<HTMLElement>(`[data-template-settings-record="${CSS.escape(key)}"]`) : key === "general:" ? this.frameTarget.querySelector<HTMLInputElement>('input[name="name"]') : null;
    const savedForm = this.frameTarget.querySelector<HTMLFormElement>("[data-template-settings-saved-form]");
    const actions = savedForm && !savedForm.hasAttribute("data-template-settings-autosave") ? savedForm.querySelector<HTMLElement>("[data-template-settings-save-actions]") : null;
    const submittedFocus = this.submittedFocus;
    this.submittedFocus = undefined;
    const focusForm = submittedFocus ? this.frameTarget.querySelector<HTMLFormElement>(`[data-template-settings-form-key="${CSS.escape(submittedFocus.key)}"]`) : null;
    requestAnimationFrame(() => {
      if (focusForm && submittedFocus && (!actions || focusForm !== savedForm)) {
        const input = focusForm.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${CSS.escape(submittedFocus.name)}"]`)!;
        input.focus({ preventScroll: true });
        if (submittedFocus.start !== null) input.setSelectionRange(submittedFocus.start, submittedFocus.end);
      } else if (actions?.isConnected) {
        actions.focus({ preventScroll: true });
        actions.scrollIntoView({ block: "nearest" });
      } else if (!content.hasAttribute("data-template-settings-submitted-path") && record) {
        record.focus({ preventScroll: true });
        record.scrollIntoView({ block: "nearest" });
      }
      savedForm?.removeAttribute("data-template-settings-saved-form");
      this.formTargets.forEach(form => this.queueAutosave(form));
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
    this.formTargets.forEach(form => this.queueAutosave(form));
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
    if (this.bypass || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("a[href], [data-workspace-entry-id]") : null;
    if (!target || target.closest("dialog")) return;
    const inside = this.element.contains(target);
    if (event.altKey && !(inside && target.closest('[data-template-settings-target="developer"]'))) return;
    // Normal links opening another tab do not abandon the current draft.
    if (target instanceof HTMLAnchorElement && target.target === "_blank") return;
    const action = (): void => {
      if (!inside) this.leave();
      this.bypass = true;
      target.click();
      this.bypass = false;
    };
    // Turbo ignores Alt-clicks; the revealed developer entry uses the same replay path.
    if (event.altKey || this.submissions || this.dirty() || !inside) {
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
    const active = document.activeElement;
    if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && this.element.contains(active)) {
      const form = active.closest<HTMLFormElement>("form")!;
      this.submittedFocus = { key: form.dataset.templateSettingsFormKey!, name: active.name, start: active.selectionStart, end: active.selectionEnd };
    }
    const nextContent = nextFrame.querySelector<HTMLElement>('[data-template-settings-target="content"]')!;
    const submittedPath = nextContent.dataset.templateSettingsSubmittedPath;
    const scrollTop = this.frameTarget.querySelector<HTMLElement>(".panel__body")!.scrollTop;
    // A save refreshes server-owned markup without throwing away drafts in other editors.
    if (submittedPath) {
      const submittedAction = new URL(submittedPath, location.href).href;
      for (const current of this.frameTarget.querySelectorAll<HTMLDetailsElement>("details[data-template-settings-disclosure]")) {
        const next = nextFrame.querySelector<HTMLDetailsElement>(`[data-template-settings-disclosure="${CSS.escape(current.dataset.templateSettingsDisclosure!)}"]`);
        const creating = current.dataset.templateSettingsDisclosure!.endsWith(":new") && current.querySelector<HTMLFormElement>("form")!.action === submittedAction;
        if (next && !creating) next.open = current.open;
      }
      for (const current of this.formTargets) {
        if (current.action === submittedAction || `${current.action}/delete` === submittedAction || this.originals.get(current) === this.values(current)) continue;
        const next = nextFrame.querySelector<HTMLFormElement>(`[data-template-settings-form-key="${CSS.escape(current.dataset.templateSettingsFormKey!)}"]`);
        if (!next) continue;
        // SAFETY: Cloning an HTMLFormElement preserves its element type.
        const preserved = current.cloneNode(true) as HTMLFormElement;
        preserved.inert = false;
        preserved.dataset.templateSettingsAvailable = next.dataset.templateSettingsAvailable;
        for (const textarea of preserved.querySelectorAll<HTMLTextAreaElement>("textarea")) textarea.readOnly = next.querySelector<HTMLTextAreaElement>(`textarea[name="${CSS.escape(textarea.name)}"]`)!.readOnly;
        preserved.removeAttribute("data-template-settings-saved-form");
        this.preservedOriginals.set(current.dataset.templateSettingsFormKey!, this.originals.get(current)!);
        next.replaceWith(preserved);
      }
    }
    this.renders++;
    try {
      await render();
      if (submittedPath) this.frameTarget.querySelector<HTMLElement>(".panel__body")!.scrollTop = scrollTop;
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
