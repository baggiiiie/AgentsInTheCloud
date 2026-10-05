import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { actionItemHtml } from "@agents-in-the-cloud/design-system/action-item";
import { popupHtml } from "@agents-in-the-cloud/design-system/popup";
import { domId, escapeHtml } from "@agents-in-the-cloud/shared";
import { parseDiffFromFile, type CodeViewItem } from "@pierre/diffs";
import type { ReviewFile } from "@agents-in-the-cloud/review/diff";
import type { ChangesSnapshot } from "./snapshot.ts";

export const changesBodyId = (workspaceId: string, snapshotId: string) => domId("changes", workspaceId, snapshotId, "body");
const json = <Value>(value: Value) => JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("&", "\\u0026");

export function renderChangesFile(file: ReviewFile, snapshotId: string): string {
  const item: CodeViewItem<undefined> = file.diff
    ? { id: file.path, type: "diff", fileDiff: file.diff, version: 1 }
    : { id: file.path, type: "file", version: 1, file: { name: file.path, lang: "text", contents: file.detail ?? "No text changes to display.", cacheKey: `${snapshotId}:${file.path}` } };
  return `<script type="application/json" data-changes-file>${json(item)}</script>`;
}

export function renderChanges(workspaceId: string, snapshot: ChangesSnapshot): string {
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
  const sidebarId = domId("changes", workspaceId, snapshot.id, "files");
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
    trailingHtml: `<span class="changes-file-stats">${file.binarySizes ? "<span>Binary</span>" : `<span class="changes-additions">+${file.additions}</span><span class="changes-deletions">−${file.deletions}</span>`}${file.previousPath ? `<span class="changes-rename" title="Previously ${escapeHtml(file.previousPath)}">Renamed</span>` : ""}</span>`,
    element: { tag: "button", attributesHtml: `type="button" data-path="${escapeHtml(file.path)}" data-action="changes#toggleFile" aria-expanded="true"` },
  })}</div></template>`).join("");
  const empty = snapshot.index.phase === "not-git" ? "This workspace isn’t a Git repository." : "No changes. The working tree matches HEAD.";
  // A snapshot-keyed permanent island keeps live shell morphs from erasing Pierre’s managed DOM.
  return `<section id="${changesBodyId(workspaceId, snapshot.id)}" data-turbo-permanent class="changes-body" data-controller="changes" data-action="keydown.esc->changes#closeFiles" data-changes-workspace-id-value="${escapeHtml(workspaceId)}" data-changes-snapshot-id-value="${snapshot.id}">
    <header class="changes-toolbar">
      <span class="changes-mobile-navigation">${files.length ? iconButton("Show changed files", "toggleFiles", Icons.Files, `data-changes-target="filesToggle" aria-expanded="false" aria-controls="${sidebarId}"`) : ""}</span>
      <div class="changes-comparison"><strong>Uncommitted changes</strong><span class="changes-summary">${files.length} ${files.length === 1 ? "file" : "files"} <span class="changes-additions">+${additions}</span> <span class="changes-deletions">−${deletions}</span></span></div>
      <div class="changes-controls">${files.length ? iconButton("Collapse all files", "toggleCollapse", collapseIcons, 'data-changes-target="collapseToggle" aria-pressed="false"') : ""}${displayMenu}<form method="post" action="/workspaces/${encodeURIComponent(workspaceId)}/changes/refresh?snapshot=${snapshot.id}">${buttonHtml({ type: "submit", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Refresh, label: "Refresh changes" } })}</form></div>
    </header>
    <div class="changes-error" data-changes-target="error" role="alert" hidden></div>
    ${files.length ? `<div class="changes-surface"><button type="button" class="changes-backdrop" data-action="changes#closeFiles" aria-label="Close changed files" tabindex="-1"></button><aside id="${sidebarId}" class="changes-sidebar" aria-label="Changed files"><header class="changes-sidebar-header"><strong>Changed files</strong><div><span class="changes-mobile-navigation">${iconButton("Close changed files", "closeFiles", Icons.Close)}</span></div></header><div class="changes-tree" data-changes-target="tree" data-action="click->changes#activateTreeFile keydown.enter->changes#activateTreeFile:capture keydown.space->changes#activateTreeFile:capture"></div></aside><div class="changes-viewer agents-in-the-cloud-pierre-host" data-changes-target="viewer" aria-label="Uncommitted diffs"></div></div><footer class="changes-footer"><span data-changes-target="activeFile">${escapeHtml(files[0]!.path)}</span><span>HEAD → working tree</span></footer>` : `<div class="changes-empty">${escapeHtml(empty)}</div>`}
    <script type="application/json" data-changes-target="model">${json({ files, items })}</script>${headers}
  </section>`;
}
