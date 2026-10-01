import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { actionItemHtml } from "@atelier/design-system/action-item";
import { actionLinkHtml } from "@atelier/design-system/action-link";
import { escapeHtml } from "@atelier/shared";
import { sessionShareDir, workspaceSessionShareKey } from "./session-store.ts";
import { durableJournalDirectory } from "./durable-storage.ts";
import { retainedDurableWorkspaceOwner } from "./durable-owner.ts";
import { projectDurableTranscript } from "./durable-transcript.ts";
import { findTranscriptItem } from "./transcript.ts";
import { renderTranscriptItem, renderTranscriptItemDetailFrame } from "./render-transcript.ts";
import { type AgentRouteHandler } from "./route-support.ts";
import type { DurableAgentRuntime } from "./durable-runtime.ts";

/** Enumerate the viewer's existing share, including journals whose workspace was deleted. */
export async function retainedDurableHistories(workspaceId: string) {
  // Validate the external workspace identifier before reading its share metadata.
  durableJournalDirectory("projectless", workspaceId);
  const share = await workspaceSessionShareKey(workspaceId);
  const directory = join(sessionShareDir(share), "builtin-durable");
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const histories: { workspaceId: string; owner: DurableAgentRuntime }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = durableJournalDirectory(share, entry.name);
    if (!await Bun.file(join(path, "main.jsonl")).exists()) continue;
    histories.push({ workspaceId: entry.name, owner: await retainedDurableWorkspaceOwner(path, entry.name) });
  }
  return histories;
}

function html(content: string, status = 200) { return new Response(content, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }

/** Read-only HTTP surface: never mounts a live runtime, probes readiness, or resumes a scheduler. */
export const handleDurableHistoryRequest: AgentRouteHandler = async (request, url, options) => {
  const match = url.pathname.match(/^\/workspaces\/([^/]+)\/agent-history(?:\/([^/]+)\/([^/]+)(?:\/(session-images|transcript-items)\/([^/]+)(?:\/(\d+))?)?)?$/);
  if (!match || request.method !== "GET") return undefined;
  function page(title: string, content: string) {
    if (!options.renderPage) throw new Error("Native history requires the host page renderer");
    const response = options.renderPage(`<div class="app no-sidebar"><div class="main"><header class="header"><h1>${escapeHtml(title)}</h1></header><main class="body">${content}</main></div></div>`);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const viewer = decodeURIComponent(match[1]!);
  const [source = "", conversationId = "", operation = "", item = "", index = ""] = match.slice(2).map(value => value === undefined ? "" : decodeURIComponent(value));
  const base = `/workspaces/${encodeURIComponent(viewer)}/agent-history`;
  const histories = await retainedDurableHistories(viewer);
  if (!source) {
    const rows: string[] = [];
    for (const history of histories) {
      const gates = await history.owner.admission();
      for (const record of await history.owner.catalog()) {
        const state = gates?.deleted ? "Deleted workspace" : gates?.closed.includes(record.durableId) ? "Closed conversation" : "Conversation";
        rows.push(actionItemHtml({ kind: "single", label: { kind: "text", text: record.title }, description: `${history.workspaceId} · ${record.label} · ${state}`, element: { tag: "a", attributesHtml: `href="${base}/${encodeURIComponent(history.workspaceId)}/${encodeURIComponent(record.conversationId)}"` } }));
      }
    }
    return page("Agent history", `<p>Read-only history from this project's session share.</p><div class="action-list">${rows.join("") || "No native history yet."}</div>`);
  }
  const history = histories.find(history => history.workspaceId === source);
  const record = history && (await history.owner.catalog()).find(record => record.conversationId === conversationId);
  if (!history || !record) return html("Not found", 404);
  const controller = await history.owner.conversation(record);
  if (operation === "session-images") return controller.image(item, Number(index));
  const branch = url.searchParams.get("branch") ?? String(record.durableId);
  if (!(record.branches ?? [record.durableId]).some(id => String(id) === branch)) return html("Not found", 404);
  const ctx = { workspaceId: source, conversationId, readOnly: true, transcriptQuery: `branch=${encodeURIComponent(branch)}`, transcriptBasePath: `${base}/${encodeURIComponent(source)}/${encodeURIComponent(conversationId)}` };
  const view = await controller.historyView(branch);
  const items = projectDurableTranscript(view);
  if (operation === "transcript-items") {
    const selected = findTranscriptItem(items, item);
    const count = Math.max(100, Math.min(100_000, Number(url.searchParams.get("count") ?? 100) || 100));
    return selected ? html(renderTranscriptItemDetailFrame(ctx, selected, { count })) : html("Not found", 404);
  }
  const branches = (record.branches ?? [record.durableId]).map(id => actionLinkHtml({ href: `${ctx.transcriptBasePath}?branch=${id}`, variant: "secondary", content: { kind: "caption", caption: `Branch ${id}${id === record.durableId ? " (current)" : ""}` } })).join(" ");
  return page(record.title, `${actionLinkHtml({ href: base, variant: "secondary", content: { kind: "caption", caption: "All history" } })}<nav>${branches}</nav><p>Full branch history, including earlier sessions. This view is read-only.</p><div class="agent-transcript"><div class="agent-transcript-content">${items.map(item => renderTranscriptItem(ctx, item)).join("")}</div></div>`);
};
