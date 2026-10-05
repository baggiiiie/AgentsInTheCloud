import { recentWorkspaceTemplateStorageKey } from "@agents-in-the-cloud/shared";
import { Controller } from "@hotwired/stimulus";
import { registerWorkspaceControllers, residencyController } from "./workspace-controller-registry.ts";
import { markActiveWorkspaceRow } from "./workspace-presentation.ts";

class EmptyWorkspaceOnboardingController extends Controller<HTMLElement> {
  static targets = ["origin", "svg", "path"];
  static values = { destination: String };

  declare readonly originTarget: HTMLElement;
  declare readonly svgTarget: SVGSVGElement;
  declare readonly pathTarget: SVGPathElement;
  declare readonly destinationValue: "first-workspace";

  private observer: MutationObserver | undefined;
  private resizeObserver: ResizeObserver | undefined;

  connect(): void {
    window.addEventListener("resize", this.draw);
    window.addEventListener("workspace-pane:slide-changed", this.draw);
    const empty = this.element.closest(".workspace-detail-empty")!;
    this.observer = new MutationObserver(this.draw);
    this.observer.observe(empty, { attributes: true, attributeFilter: ["hidden"] });
    this.observer.observe(this.element.closest(".fixed-shell-app")!, { attributes: true, attributeFilter: ["class"] });
    // Draws once the welcome text has a layout, and again whenever it moves.
    this.resizeObserver = new ResizeObserver(this.draw);
    this.resizeObserver.observe(this.originTarget);
  }

  disconnect(): void {
    window.removeEventListener("resize", this.draw);
    window.removeEventListener("workspace-pane:slide-changed", this.draw);
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
  }

  private draw = (): void => {
    const origin = this.originTarget.getBoundingClientRect();
    if (origin.width === 0) return;
    const start = { x: origin.left + origin.width / 2, y: origin.bottom + 12 };
    const destinationElement = document.querySelector<HTMLElement>(`[data-empty-workspace-onboarding-destination="${this.destinationValue}"]`)!;
    const destination = destinationElement.getBoundingClientRect();
    // The destination slides away while someone is already choosing what to put in the workspace.
    const hidden = destination.width === 0 || Boolean(destinationElement.closest("[inert]"));
    this.svgTarget.style.visibility = hidden ? "hidden" : "";
    if (hidden) return;
    const end = { x: destination.right + 5, y: destination.top + destination.height / 2 };
    const horizontalDirection = end.x >= start.x ? 1 : -1;
    const horizontalBend = Math.min(180, Math.max(40, Math.abs(end.x - start.x) * 0.7));
    const verticalBend = Math.min(150, Math.max(70, Math.abs(end.y - start.y) * 0.45));
    this.svgTarget.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
    this.pathTarget.setAttribute("d", `M ${start.x} ${start.y} C ${start.x} ${start.y + verticalBend}, ${end.x - horizontalDirection * horizontalBend} ${end.y}, ${end.x} ${end.y}`);
  };
}

/** Slides the workspace pane between the workspace list and the "New workspace" template picker. */
class WorkspacePaneController extends Controller<HTMLElement> {
  static targets = ["workspacesHeader", "pickerHeader", "workspaces", "picker", "newWorkspace", "option", "value", "addFirst"];
  declare readonly workspacesHeaderTarget: HTMLElement;
  declare readonly pickerHeaderTarget: HTMLElement;
  declare readonly workspacesTarget: HTMLElement;
  declare readonly pickerTarget: HTMLElement;
  declare readonly newWorkspaceTarget: HTMLElement;
  declare readonly optionTargets: HTMLElement[];
  declare readonly valueTarget: HTMLInputElement;
  declare readonly addFirstTarget: HTMLElement;
  declare readonly hasAddFirstTarget: boolean;
  /** Undefined until a choice exists: with no templates yet, nothing is preselected. */
  private selected: string | undefined;
  private knownWorkspaceTemplateIds = new Set<string>();
  private optionsObserver?: MutationObserver;

  connect(): void {
    this.knownWorkspaceTemplateIds = new Set(this.optionTargets.map((option) => option.dataset.workspaceTemplateId!));
    // Live updates may morph existing options in place, so watch the options rather than target connections.
    this.optionsObserver = new MutationObserver(this.optionsChanged);
    this.optionsObserver.observe(this.pickerTarget, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-workspace-template-id", "aria-checked"] });
    document.addEventListener("agents-in-the-cloud:mobile-workspace-pane-changed", this.mobileWorkspacePaneChanged);
  }

  disconnect(): void {
    document.removeEventListener("agents-in-the-cloud:mobile-workspace-pane-changed", this.mobileWorkspacePaneChanged);
    this.optionsObserver?.disconnect();
  }

  /** "New workspace" starts from the current workspace's template. */
  openPicker(): void {
    const active = this.element.querySelector<HTMLElement>("[data-workspace-entry-id][aria-current='page']");
    this.showPicker(this.hasAddFirstTarget ? undefined : active?.dataset.workspaceTemplateId ?? "");
  }

  /** A row's template icon starts from that row's template. */
  openPickerFor({ params }: { params: { workspaceTemplate: string } }): void {
    this.showPicker(params.workspaceTemplate);
  }

  back(): void {
    this.showWorkspaces();
    this.newWorkspaceTarget.focus({ preventScroll: true });
  }

  choose(event: Event): void {
    // SAFETY: This action is attached only to server-rendered template options.
    this.select((event.currentTarget as HTMLElement).dataset.workspaceTemplateId!);
  }

  optionKeydown(event: KeyboardEvent): void {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const options = this.optionTargets;
    // SAFETY: This action is attached only to server-rendered template options.
    const next = options[(options.indexOf(event.currentTarget as HTMLElement) + step + options.length) % options.length]!;
    this.select(next.dataset.workspaceTemplateId!);
    next.focus();
  }

  submitted(): void {
    this.showWorkspaces();
  }

  slid(event: TransitionEvent): void {
    if (event.target === event.currentTarget) window.dispatchEvent(new CustomEvent("workspace-pane:slide-changed"));
  }

  private showPicker(workspaceTemplateId: string | undefined): void {
    this.select(workspaceTemplateId);
    this.setPicking(true);
    const checked = this.optionTargets.find((option) => option.getAttribute("aria-checked") === "true");
    (checked ?? this.addFirstTarget).focus({ preventScroll: true });
  }

  private showWorkspaces(): void {
    this.setPicking(false);
  }

  private setPicking(picking: boolean): void {
    this.element.classList.toggle("is-picking-template", picking);
    this.workspacesTarget.inert = picking;
    this.pickerTarget.inert = !picking;
    this.workspacesHeaderTarget.hidden = picking;
    this.pickerHeaderTarget.hidden = !picking;
    window.dispatchEvent(new CustomEvent("workspace-pane:slide-changed"));
  }

  private select(workspaceTemplateId: string | undefined): void {
    const available = this.optionTargets.some((option) => option.dataset.workspaceTemplateId === workspaceTemplateId);
    this.selected = workspaceTemplateId === undefined ? undefined : available ? workspaceTemplateId : "";
    this.valueTarget.value = this.selected ?? "";
    for (const option of this.optionTargets) {
      const checked = option.dataset.workspaceTemplateId === this.selected;
      // Only write real changes: the options observer watches this attribute.
      if (option.getAttribute("aria-checked") !== String(checked)) option.setAttribute("aria-checked", String(checked));
      option.tabIndex = checked || (this.selected === undefined && option === this.optionTargets[0]) ? 0 : -1;
    }
  }

  /** Server updates refresh the options; a template that was just added becomes the choice, otherwise keep it. */
  private readonly optionsChanged = (): void => {
    const workspaceTemplateIds = this.optionTargets.map((option) => option.dataset.workspaceTemplateId!);
    const added = workspaceTemplateIds.find((workspaceTemplateId) => !this.knownWorkspaceTemplateIds.has(workspaceTemplateId));
    this.knownWorkspaceTemplateIds = new Set(workspaceTemplateIds);
    this.select(added ?? this.selected);
  };

  private readonly mobileWorkspacePaneChanged = (): void => {
    if (!this.element.closest(".fixed-shell-app")!.classList.contains("is-mobile-workspace-pane-open")) this.showWorkspaces();
  };
}

class WorkspaceNavigationController extends Controller<HTMLElement> {
  static targets = ["scroll"];
  declare readonly scrollTarget: HTMLElement;
  private scrollTimer?: ReturnType<typeof setTimeout>;

  connect(): void {
    this.scrollTarget.addEventListener("scroll", this.scrolled, { passive: true });
    this.element.addEventListener("agents-in-the-cloud:mobile-resident-destination-selected", this.mobileResidentDestinationSelected);
    document.addEventListener("agents-in-the-cloud:workspace-pane-changed", this.workspacePaneChanged);
    const scroll = Number(localStorage.getItem("agents-in-the-cloud:workspace-pane-scroll"));
    if (Number.isFinite(scroll)) this.scrollTarget.scrollTop = scroll;
    this.setWorkspacePaneOpen(!this.element.querySelector(".workspace-detail-resident.visible"));
    this.setWorkspacePaneCollapsed(sessionStorage.getItem("agents-in-the-cloud:workspace-pane-collapsed") === "true" && Boolean(this.visibleWorkspacePaneToggle()));
  }

  disconnect(): void {
    this.scrollTarget.removeEventListener("scroll", this.scrolled);
    this.element.removeEventListener("agents-in-the-cloud:mobile-resident-destination-selected", this.mobileResidentDestinationSelected);
    document.removeEventListener("agents-in-the-cloud:workspace-pane-changed", this.workspacePaneChanged);
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
  }

  closeWorkspacePane(): void {
    this.setWorkspacePaneOpen(false);
    this.element.querySelector<HTMLElement>(".workspace-detail-resident.visible [data-show-workspace-list]")!.focus();
  }

  showWorkspacePane(): void {
    this.setWorkspacePaneOpen(true);
  }

  toggleWorkspacePaneCollapsed(): void {
    const collapsed = !this.element.classList.contains("is-workspace-pane-collapsed");
    const toggle = collapsed
      ? this.visibleWorkspacePaneToggle()
      : this.element.querySelector<HTMLButtonElement>("[data-collapse-workspace-pane]");
    if (!toggle) return;
    this.setWorkspacePaneCollapsed(collapsed);
    requestAnimationFrame(() => toggle.focus());
  }

  private setWorkspacePaneCollapsed(collapsed: boolean): void {
    this.element.classList.toggle("is-workspace-pane-collapsed", collapsed);
    sessionStorage.setItem("agents-in-the-cloud:workspace-pane-collapsed", String(collapsed));
  }

  private visibleWorkspacePaneToggle(): HTMLButtonElement | null {
    return this.element.querySelector<HTMLButtonElement>(".workspace-detail-resident.visible [data-show-workspace-pane]");
  }

  private setWorkspacePaneOpen(open: boolean): void {
    this.element.classList.toggle("is-mobile-workspace-pane-open", open);
    document.dispatchEvent(new CustomEvent("agents-in-the-cloud:mobile-workspace-pane-changed"));
  }

  private readonly mobileResidentDestinationSelected = (): void => this.setWorkspacePaneOpen(false);
  private readonly workspacePaneChanged = (): void => {
    const workspaceId = residencyController()?.visibleWorkspaceId();
    if (workspaceId) this.setActiveWorkspace(workspaceId);
  };

  async selectWorkspace(event: Event): Promise<void> {
    // SAFETY: This action is attached only to server-rendered Workspace entry elements.
    const workspaceId = (event.currentTarget as HTMLElement).dataset.workspaceEntryId;
    if (workspaceId) await this.selectWorkspaceById(workspaceId);
  }

  async selectWorkspaceById(workspaceId: string): Promise<void> {
    this.setWorkspacePaneOpen(false);
    this.setActiveWorkspace(workspaceId);
    await residencyController()?.selectWorkspace(workspaceId, `/workspaces/${encodeURIComponent(workspaceId)}`);
  }

  async parkWorkspace(event: Event): Promise<void> {
    event.preventDefault();
    // SAFETY: This action is attached only to the server-rendered Agent-pane park form.
    const form = event.currentTarget as HTMLFormElement;
    await this.submitParkedState(form);
  }

  async unparkWorkspace(event: Event): Promise<void> {
    event.preventDefault();
    // SAFETY: This action is attached only to server-rendered unpark forms.
    const form = event.currentTarget as HTMLFormElement;
    const workspaceId = form.querySelector<HTMLElement>("[data-workspace-entry-id]")!.dataset.workspaceEntryId!;
    await this.submitParkedState(form);
    await this.selectWorkspaceById(workspaceId);
  }

  private async submitParkedState(form: HTMLFormElement): Promise<void> {
    const button = form.querySelector<HTMLButtonElement>("button[type='submit']")!;
    button.disabled = true;
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { Accept: "text/vnd.turbo-stream.html" },
      });
      if (!response.ok) throw new Error(`Could not update parked workspace: HTTP ${response.status}`);
      const html = await response.text();
      if (html) window.Turbo?.renderStreamMessage(html);
    } finally {
      button.disabled = false;
    }
  }

  setActiveWorkspace(workspaceId: string): void {
    markActiveWorkspaceRow(this.element, workspaceId);
    const row = this.element.querySelector<HTMLElement>(`[data-workspace-entry-id="${CSS.escape(workspaceId)}"]`);
    if (!row) return;
    if (row.dataset.workspaceTemplateId) localStorage.setItem(recentWorkspaceTemplateStorageKey, row.dataset.workspaceTemplateId);
    else localStorage.removeItem(recentWorkspaceTemplateStorageKey);
  }

  private scrolled = (): void => {
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => localStorage.setItem("agents-in-the-cloud:workspace-pane-scroll", String(this.scrollTarget.scrollTop)), 80);
  };
}

export function registerWorkspaceNavigationControllers(): void {
  registerWorkspaceControllers({
    "empty-workspace-onboarding": EmptyWorkspaceOnboardingController,
    "workspace-navigation": WorkspaceNavigationController,
    "workspace-pane": WorkspacePaneController,
  });
}
