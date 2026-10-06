import { setActionItemLabel } from "@agents-in-the-cloud/design-system/action-item/client";
import type { WorkspaceClientControllerConstructor } from "@agents-in-the-cloud/shared";
import { endpointName, isUnpushedRange, historyGraph, rangeDescription, selectedGraph, rowHeight, type ChangesRange, type HistoryGraph, type HistoryModel } from "../history.ts";

type ComparisonModel = { range: ChangesRange; label: string; baseLabel: string; endLabel: string };

export function createRangeController(Controller: WorkspaceClientControllerConstructor) {
  return class ChangesRangeController extends Controller {
    declare readonly element: HTMLElement;
    static targets = ["diff", "trigger", "refresh", "picker", "loading", "error", "historyModel", "comparisonModel", "graph", "table", "row", "historyScroll", "selectionBox", "more"];
    static values = { workspaceId: String, historyId: String, open: Boolean };
    declare readonly workspaceIdValue: string;
    declare readonly historyIdValue: string;
    declare readonly openValue: boolean;
    declare readonly diffTarget: HTMLElement;
    declare readonly triggerTarget: HTMLButtonElement;
    declare readonly hasTriggerTarget: boolean;
    declare readonly refreshTarget: HTMLButtonElement;
    declare readonly pickerTarget: HTMLElement;
    declare readonly hasPickerTarget: boolean;
    declare readonly loadingTarget: HTMLElement;
    declare readonly errorTarget: HTMLElement;
    declare readonly graphTarget: SVGSVGElement;
    declare readonly tableTarget: HTMLTableElement;
    declare readonly rowTargets: HTMLTableRowElement[];
    declare readonly historyScrollTarget: HTMLElement;
    declare readonly selectionBoxTarget: HTMLElement;
    declare readonly moreTarget: HTMLButtonElement;
    declare readonly hasMoreTarget: boolean;
    private model?: HistoryModel;
    private graph?: HistoryGraph;
    private range?: ChangesRange;
    private comparison?: ComparisonModel;
    private anchor?: string;
    private gesture?: { pointer: number; last: string; deferred: boolean; extend: boolean };
    private isOpen = false;
    private busy = false;
    private failed = false;
    private readonly client = crypto.randomUUID();
    private sequence = 0;
    private request?: AbortController;
    private paging?: AbortController;
    private resize?: ResizeObserver;
    private lastOperation: "compare" | "refresh" | "history" = "compare";

    connect(): void {
      this.resize = new ResizeObserver(() => this.measure());
      this.resize.observe(this.element);
      if (this.hasPickerTarget) {
        this.pickerTarget.hidden = !this.openValue;
        this.resize.observe(this.pickerTarget);
      }
      if (this.openValue) this.openPicker();
      this.measure();
    }
    disconnect(): void { this.request?.abort(); this.paging?.abort(); this.resize?.disconnect(); }

    historyModelTargetConnected(script: HTMLScriptElement): void {
      // SAFETY: This model is emitted by the Changes history renderer, not an external endpoint.
      this.model = JSON.parse(script.textContent!) as HistoryModel;
      this.graph = historyGraph(this.model.commits);
      this.range ??= this.model.range;
      this.anchor ??= this.range.unpushed ? this.range.newest : this.range.oldest;
      this.paint();
    }
    comparisonModelTargetConnected(script: HTMLScriptElement): void {
      // SAFETY: The comparison endpoint emits the applied range alongside its server-rendered viewer.
      this.comparison = JSON.parse(script.textContent!) as ComparisonModel;
      this.range ??= this.comparison.range;
      if (this.model) this.paint();
      this.syncAvailability();
      queueMicrotask(() => { if (this.element.isConnected) this.measure(); });
    }
    preservePresentation(event: CustomEvent<{ newStream: { templateElement: HTMLTemplateElement } }>): void {
      for (const shell of event.detail.newStream.templateElement.content.querySelectorAll<HTMLElement>(".changes-body")) {
        if (shell.dataset.changesRangeWorkspaceIdValue !== this.workspaceIdValue) continue;
        shell.dataset.changesRangeOpenValue = String(this.isOpen);
        shell.dataset.changesLayout = this.element.dataset.changesLayout ?? "unified";
        shell.dataset.changesWrap = this.element.dataset.changesWrap ?? "false";
      }
    }

    triggerTargetConnected(button: HTMLButtonElement): void { button.setAttribute("aria-expanded", String(this.isOpen || this.openValue)); }

    togglePicker(): void { if (this.isOpen) this.closePicker(); else this.openPicker(); }
    private openPicker(): void {
      if (!this.hasPickerTarget) return;
      this.isOpen = true;
      this.element.classList.add("changes-range-open");
      this.pickerTarget.hidden = false;
      this.triggerTarget.setAttribute("aria-expanded", "true");
      this.paint();
      this.syncAvailability();
      this.measure();
      const row = this.rowTargets.find(row => row.dataset.commit === this.range!.newest)!;
      row.focus({ preventScroll: true });
      if (this.range!.unpushed) this.historyScrollTarget.scrollTop = 0;
      else row.scrollIntoView({ block: "nearest" });
    }
    closePicker(): void {
      if (!this.isOpen) return;
      // Closing during a drag commits its final preview, just like releasing the pointer.
      if (this.gesture) { const apply = !this.gesture.deferred; this.gesture = undefined; if (apply) void this.generate("compare"); }
      this.isOpen = false;
      this.element.classList.remove("changes-range-open");
      this.pickerTarget.hidden = true;
      this.triggerTarget.setAttribute("aria-expanded", "false");
      this.syncAvailability();
      this.measure();
      this.triggerTarget.focus();
    }
    escape(event: KeyboardEvent): void {
      if (!this.isOpen || this.element.querySelector(".popup-menu:popover-open")) return;
      event.preventDefault();
      event.stopPropagation();
      this.closePicker();
    }

    private modified(event: MouseEvent | KeyboardEvent): boolean { return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey; }
    private commitAt(element: Element, clientY: number): string | undefined {
      const dot = element.closest<SVGCircleElement>("[data-dot]");
      if (dot) return dot.dataset.dot;
      if (element.closest("[data-changes-range-target=graph]")) {
        return this.model!.commits[Math.floor((clientY - this.graphTarget.getBoundingClientRect().top) / rowHeight)]?.id;
      }
      return element.closest<HTMLElement>("[data-commit]")?.dataset.commit;
    }
    private choose(id: string, extend: boolean): void {
      if (!extend) this.anchor = id;
      const commits = this.model!.commits;
      const first = commits.findIndex(commit => commit.id === this.anchor);
      const second = commits.findIndex(commit => commit.id === id);
      this.range = { newest: commits[Math.min(first, second)]!.id, oldest: commits[Math.max(first, second)]!.id };
      this.paint();
    }
    beginSelection(event: PointerEvent): void {
      if (event.button !== 0) return;
      // SAFETY: This action is attached to the native history table.
      const element = event.target as Element;
      const id = this.commitAt(element, event.clientY);
      if (!id) return;
      event.preventDefault();
      const extend = this.modified(event);
      // Touching metadata/the graph can scroll. Apply a tap only on release, not on pan cancellation.
      const deferred = event.pointerType === "touch" && !element.closest(".changes-description");
      if (!deferred) this.choose(id, extend);
      this.gesture = { pointer: event.pointerId, last: id, deferred, extend };
      this.tableTarget.setPointerCapture(event.pointerId);
    }
    moveSelection(event: PointerEvent): void {
      if (!this.gesture || this.gesture.pointer !== event.pointerId || this.gesture.deferred) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element || !this.tableTarget.contains(element)) return;
      const id = this.commitAt(element, event.clientY);
      if (!id || id === this.gesture.last) return;
      event.preventDefault();
      this.gesture.last = id;
      this.choose(id, true);
      const rect = this.historyScrollTarget.getBoundingClientRect();
      if (event.clientY < rect.top + 28) this.historyScrollTarget.scrollTop -= rowHeight;
      if (event.clientY > rect.bottom - 28) this.historyScrollTarget.scrollTop += rowHeight;
    }
    finishSelection(event: PointerEvent): void {
      if (!this.gesture || this.gesture.pointer !== event.pointerId) return;
      if (this.gesture.deferred) this.choose(this.gesture.last, this.gesture.extend);
      else this.moveSelection(event);
      this.gesture = undefined;
      this.tableTarget.releasePointerCapture(event.pointerId);
      void this.generate("compare");
    }
    cancelGesture(): void { if (this.gesture) { const apply = !this.gesture.deferred; this.gesture = undefined; if (apply) void this.generate("compare"); } }

    navigate(event: KeyboardEvent): void {
      // SAFETY: Only history rows bind this action.
      const row = event.currentTarget as HTMLTableRowElement;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.choose(row.dataset.commit!, this.modified(event));
        void this.generate("compare");
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const index = this.rowTargets.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1);
        const next = this.rowTargets[index];
        if (!next) return;
        next.focus();
        if (this.modified(event)) { this.choose(next.dataset.commit!, true); void this.generate("compare"); }
      }
    }
    hover(event: PointerEvent): void {
      if (!this.isOpen || !this.graph) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const id = element && this.tableTarget.contains(element) ? this.commitAt(element, event.clientY) : undefined;
      for (const dot of this.graphTarget.querySelectorAll<SVGCircleElement>("[data-dot]")) dot.dataset.hover = String(dot.dataset.dot === id);
      for (const edge of this.graphTarget.querySelectorAll<SVGPathElement>("[data-edge-from]")) edge.dataset.hover = String(edge.dataset.edgeFrom === id || edge.dataset.edgeTo === id);
    }

    private paint(): void {
      const model = this.model!, range = this.range!, graph = this.graph!;
      const selected = selectedGraph(graph, range, model.unpushed);
      const clip = this.graphTarget.querySelector<SVGRectElement>("[data-selection-clip]")!;
      clip.setAttribute("y", String(selected.first * rowHeight + rowHeight / 2));
      clip.setAttribute("height", String((selected.last - selected.first) * rowHeight));
      this.selectionBoxTarget.style.top = `${selected.first * rowHeight}px`;
      this.selectionBoxTarget.style.height = `${(selected.last - selected.first + 1) * rowHeight}px`;
      const focused = this.rowTargets.find(row => row === document.activeElement);
      for (const row of this.rowTargets) {
        row.tabIndex = focused ? row === focused ? 0 : -1 : row.dataset.commit === range.newest ? 0 : -1;
        const id = row.dataset.commit!, endpoint = id === range.newest || id === range.oldest;
        row.dataset.path = String(selected.path.includes(id) || endpoint);
        row.dataset.top = String(id === range.newest);
        row.dataset.bottom = String(id === range.oldest);
        row.dataset.offpath = String(selected.hidden.has(id));
        row.setAttribute("aria-selected", row.dataset.path);
      }
      for (const dot of this.graphTarget.querySelectorAll<SVGCircleElement>("[data-dot]")) {
        const id = dot.dataset.dot!, endpoint = id === range.newest || id === range.oldest;
        const color = selected.path.includes(id) || endpoint ? "var(--accent)" : `var(--changes-branch-${dot.dataset.color})`;
        dot.setAttribute("r", endpoint ? "6" : "3.5");
        dot.setAttribute("stroke", color);
        dot.setAttribute("stroke-width", endpoint ? "2" : "1.5");
        dot.setAttribute("fill", dot.dataset.ahead === "true" ? color : "var(--panel)");
        dot.dataset.offpath = String(selected.hidden.has(id));
      }
      for (const edge of this.graphTarget.querySelectorAll<SVGPathElement>("[data-edge-from]")) edge.dataset.offpath = String(selected.hidden.has(edge.dataset.edgeFrom!) || selected.hidden.has(edge.dataset.edgeTo!));
      for (const path of this.graphTarget.querySelectorAll<SVGPathElement>("[data-selected-backbone],[data-selected-beads]")) path.setAttribute("d", selected.route);
      const applied = this.comparison?.range.newest === range.newest && this.comparison.range.oldest === range.oldest && this.comparison.range.unpushed === range.unpushed;
      const description = applied ? this.comparison!.label : rangeDescription(model, range);
      setActionItemLabel(this.triggerTarget, description);
      const unpushed = isUnpushedRange(model.unpushed, range) ? model.unpushed : undefined;
      const oldest = unpushed?.oldest ?? model.commits.find(commit => commit.id === range.oldest)!;
      const base = unpushed ? unpushed.base : oldest.kind === "working" ? model.hasStaged ? "staged" : model.head : oldest.kind === "staged" ? model.head : oldest.parents[0];
      this.triggerTarget.title = applied ? `${this.comparison!.baseLabel} → ${this.comparison!.endLabel}` : `${endpointName(model, base)} → ${endpointName(model, range.newest)}`;
      this.element.style.setProperty("--changes-history-rows", String(model.commits.length));
      this.element.style.setProperty("--changes-history-chrome", this.hasMoreTarget ? "64px" : "0px");
    }
    private measure(): void {
      const toolbar = this.diffTarget.querySelector<HTMLElement>(".changes-toolbar")!;
      const top = toolbar.getBoundingClientRect().bottom - this.element.getBoundingClientRect().top;
      this.element.style.setProperty("--changes-comparison-top", `${top}px`);
    }
    private syncAvailability(): void {
      this.element.classList.toggle("changes-busy", this.busy);
      this.element.classList.toggle("changes-failed", this.failed);
      this.loadingTarget.hidden = !this.busy;
      this.refreshTarget.disabled = this.busy;
      this.diffTarget.setAttribute("aria-busy", String(this.busy));
      if (this.hasPickerTarget) {
        const refreshing = this.busy && this.lastOperation === "refresh";
        this.historyScrollTarget.inert = refreshing;
      }
      for (const element of this.diffTarget.querySelectorAll<HTMLElement>(".changes-surface,.changes-empty")) element.inert = this.busy || this.failed;
      for (const element of this.diffTarget.querySelectorAll<HTMLElement>(".changes-controls")) element.inert = this.busy;
    }

    refresh(): void { void this.generate("refresh"); }
    retry(): void { if (this.lastOperation === "history") void this.loadMore(); else void this.generate(this.lastOperation); }
    dismissError(): void { this.errorTarget.hidden = true; }
    private async generate(operation: "compare" | "refresh"): Promise<void> {
      this.request?.abort();
      if (operation === "refresh") {
        this.paging?.abort();
        if (this.gesture) {
          this.tableTarget.releasePointerCapture(this.gesture.pointer);
          this.gesture = undefined;
        }
      }
      const request = this.request = new AbortController();
      this.lastOperation = operation;
      this.busy = true;
      this.failed = false;
      this.errorTarget.hidden = true;
      this.syncAvailability();
      const data = new FormData();
      data.set("history", this.historyIdValue);
      data.set("client", this.client);
      data.set("sequence", String(++this.sequence));
      data.set("newest", this.range!.newest);
      data.set("oldest", this.range!.oldest);
      if (this.range!.unpushed) data.set("unpushed", "true");
      data.set("pickerOpen", String(this.isOpen));
      try {
        const result = await fetch(`/workspaces/${encodeURIComponent(this.workspaceIdValue)}/changes/${operation}`, { method: "POST", body: data, signal: request.signal, headers: { Accept: "text/vnd.turbo-stream.html" } });
        let html = await result.text();
        if (request.signal.aborted) return;
        if (!result.headers.get("Content-Type")?.includes("text/vnd.turbo-stream.html")) throw new Error(html || "The comparison could not be generated.");
        this.failed = !result.ok;
        if (result.ok && operation === "refresh") {
          // Preserve browser-owned presentation state, including closing the picker while refreshing.
          const document = new DOMParser().parseFromString(html, "text/html");
          const template = document.querySelector<HTMLTemplateElement>("turbo-stream template")!;
          const shell = template.content.querySelector<HTMLElement>(".changes-body")!;
          shell.dataset.changesRangeOpenValue = String(this.isOpen);
          shell.dataset.changesLayout = this.element.dataset.changesLayout ?? "unified";
          shell.dataset.changesWrap = this.element.dataset.changesWrap ?? "false";
          html = document.body.innerHTML;
        }
        window.Turbo!.renderStreamMessage(html);
        // Turbo inserts the stream synchronously; rendering its targets occurs in the next task.
        await new Promise(resolve => setTimeout(resolve, 0));
      } catch (error) {
        if (request.signal.aborted) return;
        this.failed = true;
        this.errorTarget.hidden = false;
        this.errorTarget.querySelector("span")!.textContent = `Couldn’t generate this comparison: ${error instanceof Error ? error.message : String(error)}`;
        console.error(error);
      } finally {
        if (!request.signal.aborted) { this.busy = false; this.syncAvailability(); }
      }
    }
    async loadMore(): Promise<void> {
      this.lastOperation = "history";
      this.errorTarget.hidden = true;
      this.moreTarget.disabled = true;
      const request = this.paging = new AbortController();
      const skip = this.model!.commits.filter(commit => commit.kind === "commit").length;
      try {
        const query = new URLSearchParams({ history: this.historyIdValue, skip: String(skip) });
        const result = await fetch(`/workspaces/${encodeURIComponent(this.workspaceIdValue)}/changes/history?${query}`, { signal: request.signal, headers: { Accept: "text/vnd.turbo-stream.html" } });
        const html = await result.text();
        if (request.signal.aborted) return;
        if (!result.ok) throw new Error(html);
        window.Turbo!.renderStreamMessage(html);
      } catch (error) {
        if (request.signal.aborted) return;
        this.errorTarget.hidden = false;
        this.errorTarget.querySelector("span")!.textContent = `Couldn’t load history: ${error instanceof Error ? error.message : String(error)}`;
        this.moreTarget.disabled = false;
        console.error(error);
      }
    }
  };
}
