import { renderHistoryGraph } from "./history-render.ts";
import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { actionItemHtml } from "@agents-in-the-cloud/design-system/action-item";
import { popupHtml } from "@agents-in-the-cloud/design-system/popup";
import { domId, escapeHtml } from "@agents-in-the-cloud/shared";
import { parseDiffFromFile, type CodeViewItem } from "@pierre/diffs";
import type { ReviewFile } from "@agents-in-the-cloud/review/diff";
import { type HistoryModel } from "../history.ts";
import type { ChangesHistory, ChangesSnapshot } from "./snapshot.ts";

export const changesBodyId = (workspaceId: string, historyId: string) => domId("changes", workspaceId, historyId, "body");
export const comparisonId = (workspaceId: string, historyId: string) => domId("changes", workspaceId, historyId, "comparison");
export const historyContentId = (history: ChangesHistory) => domId("changes", history.id, "history");
export const errorId = (workspaceId: string, historyId: string) => domId("changes", workspaceId, historyId, "error");
const json = <Value>(value: Value) => JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("&", "\\u0026");
export const historyModel = (history: ChangesHistory, snapshot: ChangesSnapshot): HistoryModel => ({ commits: history.commits, topology: history.topology, references: history.references, range: snapshot.range, head: history.head, branch: history.branch, upstream: history.upstream, hasStaged: history.hasStaged, unpushed: history.unpushed });

export function renderChangesTitle(snapshot: ChangesSnapshot): string {
  const additions = snapshot.stats.reduce((sum, file) => sum + file.additions, 0);
  const deletions = snapshot.stats.reduce((sum, file) => sum + file.deletions, 0);
  return snapshot.index.phase === "ready" ? `Changes +${additions} −${deletions}` : "Changes";
}

export function renderHistory(workspaceId: string, snapshot: ChangesSnapshot): string {
  const history = snapshot.history;
  const more = history.hasMore ? `<div class="changes-history-more">${buttonHtml({ type: "button", variant: "secondary", content: { kind: "caption", caption: "Load more" }, attributesHtml: 'data-action="changes-range#loadMore" data-changes-range-target="more"' })}</div>` : "";
  const model = historyModel(history, snapshot);
  return renderHistoryGraph(model, history.id, `${more}<script type="application/json" data-changes-range-target="historyModel">${json(model)}</script>`);
}

export function renderError(workspaceId: string, historyId: string, message = ""): string {
  return `<div id="${errorId(workspaceId, historyId)}" class="changes-range-error" data-changes-range-target="error" role="alert" ${message ? "" : "hidden"}><span>${escapeHtml(message)}</span>${buttonHtml({ type: "button", variant: "secondary", content: { kind: "caption", caption: "Retry" }, attributesHtml: 'data-action="changes-range#retry"' })}${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Close, label: "Dismiss comparison error" }, attributesHtml: 'data-action="changes-range#dismissError"' })}</div>`;
}

export function renderChanges(workspaceId: string, snapshot: ChangesSnapshot, pickerOpen = false): string {
  const history = snapshot.history;
  const pickerId = domId("changes", history.id, "picker");
  const header = history.phase === "ready" ? actionItemHtml({
    kind: "single", label: { kind: "text", text: snapshot.label }, leadingHtml: Icons.Disclosure,
    element: { tag: "button", attributesHtml: `type="button" data-action="changes-range#togglePicker" data-changes-range-target="trigger" aria-expanded="${pickerOpen}" aria-controls="${pickerId}"` },
  }) : '<strong>Changes</strong>';
  const picker = history.phase === "ready" ? `<div id="${pickerId}" class="changes-picker-host" data-changes-range-target="picker" role="region" aria-label="Commit history" ${pickerOpen ? "" : "hidden"}><div class="changes-history-scroll" data-changes-range-target="historyScroll">${renderHistory(workspaceId, snapshot)}</div></div>` : "";
  // History is the permanent shell; live comparisons replace only the Pierre island underneath it.
  return `<section id="${changesBodyId(workspaceId, history.id)}" data-turbo-permanent class="changes-body" data-controller="changes-range" data-changes-range-workspace-id-value="${escapeHtml(workspaceId)}" data-changes-range-history-id-value="${history.id}" data-changes-range-open-value="${pickerOpen}" data-action="live:before-stream-render@document->changes-range#preservePresentation turbo:before-stream-render@document->changes-range#preservePresentation keydown.esc->changes-range#escape pointermove@window->changes-range#moveSelection">
    <header class="changes-range-header">${header}${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Refresh, label: "Refresh history and diff" }, attributesHtml: 'data-action="changes-range#refresh" data-changes-range-target="refresh"' })}</header>${picker}${renderComparison(workspaceId, snapshot)}
    <div class="changes-loading" data-changes-range-target="loading" role="status" hidden><span class="changes-spinner" aria-hidden="true"></span><span>Generating comparison…</span></div>${renderError(workspaceId, history.id)}
  </section>`;
}

export function renderComparison(workspaceId: string, snapshot: ChangesSnapshot, collapsed = false): string {
  return `<div id="${comparisonId(workspaceId, snapshot.history.id)}" class="changes-diff-slot" data-changes-range-target="diff">${renderDiff(workspaceId, snapshot, collapsed)}</div>`;
}

export function renderChangesFile(file: ReviewFile, snapshotId: string): string {
  const item: CodeViewItem<undefined> = file.diff
    ? { id: file.path, type: "diff", fileDiff: file.diff, version: 1 }
    : { id: file.path, type: "file", version: 1, file: { name: file.path, lang: "text", contents: file.detail ?? "No text changes to display.", cacheKey: `${snapshotId}:${file.path}` } };
  return `<script type="application/json" data-changes-file>${json(item)}</script>`;
}

function renderDiff(workspaceId: string, snapshot: ChangesSnapshot, collapsed: boolean): string {
  const files = snapshot.stats;
  const items: CodeViewItem<undefined>[] = files.map((file) => {
    const captured = snapshot.files.get(file.path)!;
    if (!captured.diff) return { id: file.path, type: "file", version: 0, file: { name: file.path, lang: "text", contents: captured.detail ?? "No text changes to display.", cacheKey: `${snapshot.id}:${file.path}` } };
    const loadingDiff = parseDiffFromFile({ name: file.previousPath ?? file.path, contents: "" }, { name: file.path, contents: "Loading diff…", lang: "text" });
    loadingDiff.cacheKey = `${snapshot.id}:loading:${file.path}`;
    return { id: file.path, type: "diff", fileDiff: loadingDiff, version: 0 };
  });
  const additions = snapshot.stats.reduce((total, file) => total + file.additions, 0);
  const deletions = snapshot.stats.reduce((total, file) => total + file.deletions, 0);
  const iconButton = (label: string, action: string, icon: string, attributes = "") => buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: icon, label }, attributesHtml: `data-action="changes#${action}" ${attributes}` });
  const layoutItem = (layout: "unified" | "split", label: string) => actionItemHtml({ kind: "single", label: { kind: "text", text: label }, trailingHtml: `<span class="changes-menu-check">${Icons.Check}</span>`, element: { tag: "button", attributesHtml: `type="button" role="menuitemradio" aria-checked="${layout === "unified"}" data-layout="${layout}" data-action="changes#chooseLayout"` } });
  const displayMenu = popupHtml({
    id: domId("changes", workspaceId, snapshot.id, "display"), label: "Display options",
    trigger: { variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Settings, label: "Display options" } },
    contentHtml: `${layoutItem("unified", "Unified diff")}${layoutItem("split", "Side-by-side diff")}<hr class="popup-menu__separator">${actionItemHtml({ kind: "single", label: { kind: "text", text: "Wrap long lines" }, trailingHtml: `<span class="changes-menu-check">${Icons.Check}</span>`, element: { tag: "button", attributesHtml: 'type="button" role="menuitemcheckbox" aria-checked="false" data-action="changes#toggleWrap"' } })}`,
  });
  const collapseIcons = `<span class="changes-collapse-icon">${Icons.CollapseAll}</span><span class="changes-expand-icon">${Icons.ExpandAll}</span>`;
  const headers = snapshot.stats.map((file) => `<template data-changes-header="${escapeHtml(file.path)}"><div class="changes-file-header">${actionItemHtml({
    kind: "single", label: { kind: "text", text: file.path }, leadingHtml: Icons.Disclosure,
    trailingHtml: `${file.previousPath ? `<span class="changes-rename" title="Previously ${escapeHtml(file.previousPath)}">Renamed</span>` : ""}<span class="changes-file-stats">${file.binarySizes ? "<span>Binary</span>" : `<span class="changes-additions">+${file.additions}</span><span class="changes-deletions">−${file.deletions}</span>`}</span>`,
    element: { tag: "button", attributesHtml: `type="button" data-path="${escapeHtml(file.path)}" data-action="changes#toggleFile" aria-expanded="${!collapsed}"` },
  })}</div></template>`).join("");
  const commentTemplates = `<template data-changes-target="commentGutter">${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Plus, label: "Add a comment" }, attributesHtml: 'data-action="changes#addComment"' })}</template>
    <template data-changes-target="commentEditor"><form class="changes-comment changes-comment-editor" data-action="submit->changes#saveComment keydown.meta+enter->changes#commentShortcut keydown.ctrl+enter->changes#commentShortcut keydown.esc->changes#cancelComment"><header><span data-comment-anchor></span>${iconButton("Cancel comment", "cancelComment", Icons.Close)}</header><textarea class="textarea" rows="3" required maxlength="10000" aria-label="Comment" placeholder="Leave a comment" data-action="input->changes#commentInput"></textarea><footer><small>Temporary—cleared on refresh or comparison change.</small>${buttonHtml({ type: "submit", variant: "primary", content: { kind: "caption", caption: "Comment" } })}</footer></form></template>
    <template data-changes-target="commentCard"><article class="changes-comment"><header><span data-comment-anchor></span>${iconButton("Delete comment", "deleteComment", Icons.Trash)}</header>${actionItemHtml({ kind: "single", label: { kind: "text", text: "Comment", textAttributesHtml: "data-comment-body" }, element: { tag: "button", attributesHtml: 'type="button" aria-label="Edit comment" data-action="changes#editComment"' } })}</article></template>`;
  const empty = snapshot.index.phase === "not-git" ? "This workspace isn’t a Git repository." : snapshot.label === "Uncommitted changes" ? "No uncommitted changes." : snapshot.label === "Unstaged changes" ? "No unstaged changes." : snapshot.label === "Staged changes" ? "No staged changes." : "No changed files in this comparison.";
  // The history-keyed parent protects Pierre’s managed DOM during live shell morphs.
  return `<section id="${domId("changes", snapshot.id, "diff")}" class="changes-diff" data-controller="changes" data-changes-workspace-id-value="${escapeHtml(workspaceId)}" data-changes-snapshot-id-value="${snapshot.id}" data-changes-collapsed-value="${collapsed}">
    <header class="changes-toolbar">
      <div class="changes-controls"><span class="changes-summary">${files.length} ${files.length === 1 ? "file" : "files"} <span class="changes-additions">+${additions}</span> <span class="changes-deletions">−${deletions}</span></span>${files.length ? iconButton(collapsed ? "Expand all files" : "Collapse all files", "toggleCollapse", collapseIcons, `data-changes-target="collapseToggle" aria-pressed="${collapsed}"`) : ""}${displayMenu}</div>
    </header>
    <div id="${changesBodyId(workspaceId, snapshot.id)}-error" class="changes-error" data-changes-target="error" role="alert" hidden><span data-changes-target="errorMessage"></span>${iconButton("Dismiss file error", "dismissError", Icons.Close)}</div>
    ${files.length ? `<div class="changes-surface"><div class="changes-viewer agents-in-the-cloud-pierre-host" data-changes-target="viewer" aria-label="Changes diff"></div></div>` : `<div class="changes-empty">${escapeHtml(empty)}</div>`}
    <script type="application/json" data-changes-target="model">${json({ files, items })}</script><script type="application/json" data-changes-range-target="comparisonModel">${json({ range: snapshot.range, label: snapshot.label, baseLabel: snapshot.baseLabel, endLabel: snapshot.endLabel })}</script>${headers}${commentTemplates}
  </section>`;
}
