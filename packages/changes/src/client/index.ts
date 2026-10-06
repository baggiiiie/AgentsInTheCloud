import type { CodeView, CodeViewItem, CodeViewOptions, SelectedLineRange } from "@pierre/diffs";
import type { WorkspaceClientModule, WorkspaceClientControllerConstructor } from "@agents-in-the-cloud/shared";
import { createRangeController } from "./range-controller.ts";
import { reviewDiffOptions, wordDiffCSS } from "@agents-in-the-cloud/syntax/diff-options";

type FileSummary = { path: string };
type CommentAnnotation = { id: string; kind: "draft" | "comment"; path: string; side: "additions" | "deletions"; start: number; end: number; body: string };

function createChangesController(Controller: WorkspaceClientControllerConstructor) {
  return class ChangesController extends Controller {
    static targets = ["viewer", "model", "activeFile", "error", "errorMessage", "collapseToggle", "commentGutter", "commentEditor", "commentCard"];
    static values = { workspaceId: String, snapshotId: String };
    declare readonly viewerTarget: HTMLElement;
    declare readonly modelTarget: HTMLScriptElement;
    declare readonly activeFileTarget: HTMLElement;
    declare readonly errorTarget: HTMLElement;
    declare readonly errorMessageTarget: HTMLElement;
    declare readonly collapseToggleTarget: HTMLButtonElement;
    declare readonly commentGutterTarget: HTMLTemplateElement;
    declare readonly commentEditorTarget: HTMLTemplateElement;
    declare readonly commentCardTarget: HTMLTemplateElement;
    declare readonly workspaceIdValue: string;
    declare readonly snapshotIdValue: string;
    private viewer?: CodeView<CommentAnnotation, undefined>;
    private comments = new Map<string, CommentAnnotation>();
    private draft?: CommentAnnotation;
    private gutters = new WeakMap<HTMLElement, { path: string; hovered: () => { lineNumber: number; side?: "additions" | "deletions" } | undefined }>();
    private files: FileSummary[] = [];
    private loaded = new Set<string>();
    private pending = new Set<string>();
    private abort?: AbortController;
    private unsubscribe?: () => void;
    private activePath?: string;
    private options: CodeViewOptions<CommentAnnotation, undefined> = {};
    private layout: "unified" | "split" = "unified";
    private wrap = false;
    private collapsed = false;

    connect(): void { void this.mount(); }

    disconnect(): void {
      this.abort?.abort();
      this.unsubscribe?.();
      this.viewer?.cleanUp();
      this.viewer = undefined;
      this.loaded.clear();
      this.pending.clear();
    }

    private async mount(): Promise<void> {
      const shell = this.element.closest<HTMLElement>(".changes-body")!;
      this.layout = shell.dataset.changesLayout === "split" ? "split" : "unified";
      this.wrap = shell.dataset.changesWrap === "true";
      for (const radio of this.element.querySelectorAll<HTMLElement>("[data-layout]")) radio.setAttribute("aria-checked", String(radio.dataset.layout === this.layout));
      this.element.querySelector('[data-action="changes#toggleWrap"]')!.setAttribute("aria-checked", String(this.wrap));
      // SAFETY: renderChanges emits this private model with type-matched loading items.
      const model = JSON.parse(this.modelTarget.textContent!) as { files: FileSummary[]; items: CodeViewItem<CommentAnnotation>[] };
      this.files = model.files;
      for (const item of model.items) if (item.type === "file") this.loaded.add(item.id);
      if (!this.files.length) return;
      const abort = this.abort = new AbortController();
      const [{ CodeView }] = await Promise.all([import("@pierre/diffs"), import("@agents-in-the-cloud/syntax/pierre")]);
      if (abort.signal.aborted) return;
      this.options = {
        ...reviewDiffOptions,
        disableFileHeader: false,
        disableLineNumbers: false,
        enableLineSelection: true,
        enableGutterUtility: true,
        renderGutterUtility: (hovered, context) => {
          if (context.type !== "diff" || !this.loaded.has(context.item.id)) return null;
          // SAFETY: renderDiff emits a Button as the gutter template’s sole root.
          const button = this.commentGutterTarget.content.firstElementChild!.cloneNode(true) as HTMLElement;
          this.gutters.set(button, { path: context.item.id, hovered });
          return button;
        },
        renderAnnotation: (annotation) => this.renderComment(annotation.metadata),
        diffStyle: this.layout,
        overflow: this.wrap ? "wrap" : "scroll",
        lineDiffType: "word-line",
        stickyHeaders: true,
        layout: { paddingTop: 0, paddingBottom: 8, gap: 0 },
        itemMetrics: { diffHeaderHeight: 36 },
        unsafeCSS: `${wordDiffCSS} [data-diffs-header] { background: var(--bg); }`,
        onPostRender: (_node, _instance, _phase, context) => { void this.loadFile(context.item.id, abort.signal); },
        renderCustomHeader: (_file, context) => this.header(context.item.id, context.item.collapsed === true),
      };
      this.viewer = new CodeView<CommentAnnotation, undefined>(this.options);
      this.viewer.setup(this.viewerTarget);
      this.viewer.setItems(model.items.map((item) => ({ ...item, collapsed: this.collapsed })));
      this.unsubscribe = this.viewer.subscribeToScroll((top) => this.syncActiveFile(top));
      this.syncActiveFile(0);
    }

    dismissError(): void { this.errorTarget.hidden = true; }

    private header(path: string, collapsed: boolean): HTMLElement {
      const template = Array.from(this.element.querySelectorAll<HTMLTemplateElement>("template[data-changes-header]")).find((entry) => entry.dataset.changesHeader === path)!;
      // SAFETY: Header templates contain one server-rendered div with an Action Item button.
      const header = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
      const button = header.querySelector("button")!;
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${path}`);
      return header;
    }

    toggleFile(event: Event): void {
      // SAFETY: File disclosure actions are attached to the server-rendered header buttons.
      const path = (event.currentTarget as HTMLButtonElement).dataset.path!;
      const item = this.viewer!.getItem(path)!;
      this.viewer!.updateItem({ ...item, collapsed: !item.collapsed, version: (item.version ?? 0) + 1 });
      this.syncCollapseControl();
    }

    private syncCollapseControl(): void {
      this.collapsed = this.files.some((file) => this.viewer!.getItem(file.path)!.collapsed === true);
      this.collapseToggleTarget.setAttribute("aria-pressed", String(this.collapsed));
      const label = this.collapsed ? "Expand all files" : "Collapse all files";
      this.collapseToggleTarget.setAttribute("aria-label", label);
      this.collapseToggleTarget.title = label;
    }

    private async loadFile(path: string, signal: AbortSignal): Promise<void> {
      if (this.loaded.has(path) || this.pending.has(path)) return;
      this.pending.add(path);
      try {
        const query = new URLSearchParams({ snapshot: this.snapshotIdValue, path });
        const result = await fetch(`/workspaces/${encodeURIComponent(this.workspaceIdValue)}/changes/file?${query}`, { signal, headers: { Accept: "text/html" } });
        if (!result.ok) throw new Error(await result.text());
        const document = new DOMParser().parseFromString(await result.text(), "text/html");
        // SAFETY: The Changes file endpoint serializes a CodeViewItem captured by this snapshot.
        const item = JSON.parse(document.querySelector("script[data-changes-file]")!.textContent!) as CodeViewItem<CommentAnnotation>;
        if (signal.aborted) return;
        this.loaded.add(path);
        const previous = this.viewer!.getItem(path)!;
        this.viewer!.updateItem({ ...item, collapsed: previous.collapsed, version: (previous.version ?? 0) + 1 });
      } catch (error) {
        if (signal.aborted) return;
        this.errorTarget.hidden = false;
        this.errorMessageTarget.textContent = `Couldn’t load ${path}: ${error instanceof Error ? error.message : String(error)}. Use Refresh to try again.`;
        console.error(error);
      } finally {
        this.pending.delete(path);
      }
    }

    private syncActiveFile(top: number): void {
      const path = this.files.findLast((file) => (this.viewer!.getTopForItem(file.path) ?? Infinity) <= top + 1)?.path ?? this.files[0]!.path;
      if (path === this.activePath) return;
      this.activePath = path;
      this.activeFileTarget.textContent = path;

    }

    addComment(event: Event): void {
      // SAFETY: This action is bound to the server-rendered gutter Button.
      const gutter = this.gutters.get(event.currentTarget as HTMLElement)!;
      const hovered = gutter.hovered()!;
      const selected = this.viewer!.getSelectedLines();
      const insideSelection = selected?.id === gutter.path && (selected.range.side ?? "additions") === (hovered.side ?? "additions")
        && hovered.lineNumber >= Math.min(selected.range.start, selected.range.end) && hovered.lineNumber <= Math.max(selected.range.start, selected.range.end);
      const range = insideSelection ? selected.range : { start: hovered.lineNumber, end: hovered.lineNumber, side: hovered.side };
      this.beginComment(gutter.path, range);
    }

    private beginComment(path: string, range: SelectedLineRange): void {
      if (this.draft) {
        this.viewer!.scrollTo({ type: "line", id: this.draft.path, lineNumber: this.draft.end, side: this.draft.side, align: "center" });
        this.updateComments(this.draft.path);
        return;
      }
      if (range.endSide && range.endSide !== range.side) {
        this.errorMessageTarget.textContent = "Comment on one side of the diff at a time.";
        this.errorTarget.hidden = false;
        return;
      }
      this.draft = { id: crypto.randomUUID(), kind: "draft", path, side: range.side ?? "additions", start: Math.min(range.start, range.end), end: Math.max(range.start, range.end), body: "" };
      this.updateComments(path);
      this.viewer!.scrollTo({ type: "line", id: path, lineNumber: this.draft.end, side: this.draft.side, align: "center" });
    }

    private updateComments(path: string): void {
      const item = this.viewer!.getItem(path)!;
      if (item.type !== "diff") throw new Error("Comments require a text diff");
      const comments = [...this.comments.values()].filter(comment => comment.path === path && comment.id !== this.draft?.id);
      if (this.draft?.path === path) comments.push(this.draft);
      this.viewer!.updateItem({ ...item, annotations: comments.map(metadata => ({ lineNumber: metadata.end, side: metadata.side, metadata })), version: (item.version ?? 0) + 1 });
    }

    private renderComment(comment: CommentAnnotation): HTMLElement {
      const template = comment.kind === "draft" ? this.commentEditorTarget : this.commentCardTarget;
      // SAFETY: The server emits a form/article root for these owned annotation templates.
      const element = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
      element.dataset.commentId = comment.id;
      element.querySelector<HTMLElement>("[data-comment-anchor]")!.textContent = `${comment.side === "deletions" ? "Old" : "New"} ${comment.start === comment.end ? `line ${comment.start}` : `lines ${comment.start}–${comment.end}`}`;
      if (comment.kind === "draft") {
        const textarea = element.querySelector<HTMLTextAreaElement>("textarea")!;
        textarea.value = comment.body;
        queueMicrotask(() => textarea.focus({ preventScroll: true }));
      } else element.querySelector<HTMLElement>("[data-comment-body]")!.textContent = comment.body;
      return element;
    }

    commentInput(event: Event): void {
      // SAFETY: This action is bound to the comment template’s textarea.
      const textarea = event.currentTarget as HTMLTextAreaElement;
      this.draft!.body = textarea.value;
      textarea.setCustomValidity("");
    }
    commentShortcut(event: KeyboardEvent): void {
      event.preventDefault();
      // SAFETY: The keyboard shortcut is bound to the comment template’s form.
      (event.currentTarget as HTMLFormElement).requestSubmit();
    }
    saveComment(event: SubmitEvent): void {
      event.preventDefault();
      // SAFETY: Submit is bound to the comment template’s form.
      const form = event.currentTarget as HTMLFormElement;
      const textarea = form.querySelector<HTMLTextAreaElement>("textarea")!;
      const body = textarea.value.trim();
      if (!body) { textarea.setCustomValidity("Add a comment first."); textarea.reportValidity(); return; }
      const comment = this.draft!;
      this.comments.set(comment.id, { ...comment, kind: "comment", body });
      this.draft = undefined;
      this.updateComments(comment.path);
    }
    cancelComment(event: Event): void {
      event.preventDefault();
      event.stopPropagation();
      const path = this.draft!.path;
      this.draft = undefined;
      this.updateComments(path);
    }
    editComment(event: Event): void {
      if (this.draft) return;
      // SAFETY: These actions are bound to buttons inside an owned comment card.
      const id = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-comment-id]")!.dataset.commentId!;
      this.draft = { ...this.comments.get(id)!, kind: "draft" };
      this.updateComments(this.draft.path);
    }
    deleteComment(event: Event): void {
      // SAFETY: These actions are bound to buttons inside an owned comment card.
      const id = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-comment-id]")!.dataset.commentId!;
      const comment = this.comments.get(id)!;
      this.comments.delete(id);
      this.updateComments(comment.path);
    }

    chooseLayout(event: Event): void {
      // SAFETY: Layout actions are attached to server-rendered menu buttons.
      const value = (event.currentTarget as HTMLButtonElement).dataset.layout;
      if (value !== "unified" && value !== "split") throw new Error("Unknown diff layout");
      this.layout = value;
      this.element.closest<HTMLElement>(".changes-body")!.dataset.changesLayout = value;
      this.options = { ...this.options, diffStyle: value };
      this.viewer?.setOptions(this.options);
    }

    toggleWrap(event: Event): void {
      this.wrap = !this.wrap;
      this.element.closest<HTMLElement>(".changes-body")!.dataset.changesWrap = String(this.wrap);
      // SAFETY: The wrap action is attached to the server-rendered checkbox menu item.
      (event.currentTarget as HTMLButtonElement).setAttribute("aria-checked", String(this.wrap));
      this.options = { ...this.options, overflow: this.wrap ? "wrap" : "scroll" };
      this.viewer?.setOptions(this.options);
    }

    toggleCollapse(): void {
      this.collapsed = !this.collapsed;
      for (const file of this.files) {
        const item = this.viewer?.getItem(file.path);
        if (item) this.viewer!.updateItem({ ...item, collapsed: this.collapsed, version: (item.version ?? 0) + 1 });
      }
      this.syncCollapseControl();
    }
  };
}

export const agentsInTheCloudClientModule: WorkspaceClientModule = {
  id: "changes",
  install({ application, Controller }) { application.register("changes", createChangesController(Controller)); application.register("changes-range", createRangeController(Controller)); },
};
