import type { CodeView, CodeViewItem, CodeViewOptions } from "@pierre/diffs";
import type { FileTree } from "@pierre/trees";
import type { WorkspaceClientModule, WorkspaceClientControllerConstructor } from "@agents-in-the-cloud/shared";
import { reviewDiffOptions, wordDiffCSS } from "@agents-in-the-cloud/syntax/diff-options";

type FileSummary = { path: string; previousPath?: string; change: "added" | "modified" | "removed"; untracked?: boolean; additions: number; deletions: number; binarySizes?: object };

function createChangesController(Controller: WorkspaceClientControllerConstructor) {
  return class ChangesController extends Controller {
    static targets = ["viewer", "tree", "model", "activeFile", "error", "collapseToggle", "filesToggle"];
    static values = { workspaceId: String, snapshotId: String };
    declare readonly viewerTarget: HTMLElement;
    declare readonly treeTarget: HTMLElement;
    declare readonly modelTarget: HTMLScriptElement;
    declare readonly activeFileTarget: HTMLElement;
    declare readonly errorTarget: HTMLElement;
    declare readonly collapseToggleTarget: HTMLButtonElement;
    declare readonly filesToggleTarget: HTMLButtonElement;
    declare readonly workspaceIdValue: string;
    declare readonly snapshotIdValue: string;
    private viewer?: CodeView;
    private tree?: FileTree;
    private files: FileSummary[] = [];
    private loaded = new Set<string>();
    private pending = new Set<string>();
    private abort?: AbortController;
    private unsubscribe?: () => void;
    private syncingSelection = false;
    private activePath?: string;
    private options: CodeViewOptions<undefined, undefined> = {};
    private layout: "unified" | "split" = "unified";
    private wrap = false;
    private collapsed = false;

    connect(): void { void this.mount(); }

    disconnect(): void {
      this.abort?.abort();
      this.unsubscribe?.();
      this.viewer?.cleanUp();
      this.tree?.cleanUp();
      this.viewer = undefined;
      this.tree = undefined;
      this.loaded.clear();
      this.pending.clear();
    }

    private async mount(): Promise<void> {
      // SAFETY: renderChanges emits this private model with type-matched loading items.
      const model = JSON.parse(this.modelTarget.textContent!) as { files: FileSummary[]; items: CodeViewItem<undefined>[] };
      this.files = model.files;
      for (const item of model.items) if (item.type === "file") this.loaded.add(item.id);
      if (!this.files.length) return;
      const abort = this.abort = new AbortController();
      const [{ CodeView }, { FileTree }] = await Promise.all([import("@pierre/diffs"), import("@pierre/trees"), import("@agents-in-the-cloud/syntax/pierre")]);
      if (abort.signal.aborted) return;
      this.options = {
        ...reviewDiffOptions,
        disableFileHeader: false,
        disableLineNumbers: false,
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
      this.tree = new FileTree({
        paths: this.files.map((file) => file.path),
        initialExpansion: "open",
        flattenEmptyDirectories: true,
        search: true,
        searchBlurBehavior: "retain",
        gitStatus: this.files.map((file) => ({ path: file.path, status: file.untracked ? "untracked" : file.previousPath ? "renamed" : file.change === "removed" ? "deleted" : file.change })),
        renderRowDecoration: ({ row }) => {
          const file = this.files.find((file) => file.path === row.path);
          if (!file) return null;
          if (file.binarySizes) return { text: "Binary" };
          return { text: `+${file.additions} −${file.deletions}`, parts: [{ text: `+${file.additions}`, color: "var(--success)" }, { text: ` −${file.deletions}`, color: "var(--danger)" }] };
        },
        onSelectionChange: (paths) => {
          if (this.syncingSelection) return;
          const path = paths.at(-1);
          if (!path || !this.files.some((file) => file.path === path)) return;
          this.openFile(path);
        },
      });
      this.tree.render({ containerWrapper: this.treeTarget });
      this.viewer = new CodeView(this.options);
      this.viewer.setup(this.viewerTarget);
      this.viewer.setItems(model.items.map((item) => ({ ...item, collapsed: this.collapsed })));
      this.unsubscribe = this.viewer.subscribeToScroll((top) => this.syncActiveFile(top));
      this.syncActiveFile(0);
    }

    activateTreeFile(event: Event): void {
      const row = event.composedPath().find((target) => target instanceof HTMLElement && target.dataset.itemType === "file");
      if (!(row instanceof HTMLElement)) return;
      this.openFile(row.dataset.itemPath!);
    }

    private openFile(path: string): void {
      const item = this.viewer!.getItem(path)!;
      if (item.collapsed) {
        this.viewer!.updateItem({ ...item, collapsed: false, version: (item.version ?? 0) + 1 });
        this.viewer!.render(true);
        this.syncCollapseControl();
      }
      this.viewer!.scrollTo({ type: "item", id: path, align: "start", behavior: "instant" });
      this.activeFileTarget.textContent = path;
      if (this.element.clientWidth <= 700) this.closeFiles();
    }

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
        const item = JSON.parse(document.querySelector("script[data-changes-file]")!.textContent!) as CodeViewItem<undefined>;
        if (signal.aborted) return;
        this.loaded.add(path);
        const previous = this.viewer!.getItem(path)!;
        this.viewer!.updateItem({ ...item, collapsed: previous.collapsed, version: (previous.version ?? 0) + 1 });
      } catch (error) {
        if (signal.aborted) return;
        this.errorTarget.hidden = false;
        this.errorTarget.textContent = `Couldn’t load ${path}: ${error instanceof Error ? error.message : String(error)}. Use Refresh to try again.`;
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
      this.syncingSelection = true;
      for (const selected of this.tree!.getSelectedPaths()) this.tree!.getItem(selected)!.deselect();
      this.tree!.getItem(path)!.select();
      this.tree!.scrollToPath(path, { focus: false });
      this.syncingSelection = false;
    }

    chooseLayout(event: Event): void {
      // SAFETY: Layout actions are attached to server-rendered menu buttons.
      const value = (event.currentTarget as HTMLButtonElement).dataset.layout;
      if (value !== "unified" && value !== "split") throw new Error("Unknown diff layout");
      this.layout = value;
      this.options = { ...this.options, diffStyle: value };
      this.viewer?.setOptions(this.options);
    }

    toggleWrap(event: Event): void {
      this.wrap = !this.wrap;
      // SAFETY: The wrap action is attached to the server-rendered checkbox menu item.
      (event.currentTarget as HTMLButtonElement).setAttribute("aria-checked", String(this.wrap));
      this.options = { ...this.options, overflow: this.wrap ? "wrap" : "scroll" };
      this.viewer?.setOptions(this.options);
    }

    toggleFiles(): void {
      const open = this.element.classList.toggle("changes-files-open");
      this.filesToggleTarget.setAttribute("aria-expanded", String(open));
      this.filesToggleTarget.setAttribute("aria-label", open ? "Hide changed files" : "Show changed files");
      this.filesToggleTarget.title = open ? "Hide changed files" : "Show changed files";
      if (open) this.tree?.getItem(this.activePath ?? this.files[0]!.path)?.focus();
    }

    closeFiles(): void {
      if (!this.element.classList.contains("changes-files-open")) return;
      this.element.classList.remove("changes-files-open");
      this.filesToggleTarget.setAttribute("aria-expanded", "false");
      this.filesToggleTarget.setAttribute("aria-label", "Show changed files");
      this.filesToggleTarget.title = "Show changed files";
      this.filesToggleTarget.focus();
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
  install({ application, Controller }) { application.register("changes", createChangesController(Controller)); },
};
