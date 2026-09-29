import { ids, renderReadOnlyTranscript, renderReadOnlyTranscriptDetail, type AgentRenderContext } from "@atelier/agent/server";
import { buttonHtml } from "@atelier/design-system/button";
import { Icons } from "@atelier/design-system/icons";
import { escapeHtml } from "@atelier/shared";
import type { CliAgentAdapter } from "./adapter.ts";
import type { CliSessions } from "./sessions.ts";

type CliTranscriptContext = AgentRenderContext & { transcriptBasePath: string };
function context(workspaceId: string, conversationId: string, providerId: string): CliTranscriptContext {
  return { workspaceId, conversationId, transcriptBasePath: `/workspaces/${encodeURIComponent(workspaceId)}/${providerId}-agents/${encodeURIComponent(conversationId)}/transcript` };
}

export function renderCliTranscriptSwitch(adapter: CliAgentAdapter, workspaceId: string, conversationId: string): string {
  if (!adapter.loadTranscript) return "";
  const ctx = context(workspaceId, conversationId, adapter.id);
  return `<turbo-frame id="${ids.transcript(ctx)}" class="agent-transcript cli-transcript-view" data-cli-terminal-target="transcript" data-url="${escapeHtml(ctx.transcriptBasePath)}"></turbo-frame>
    <div class="cli-transcript-switch">${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Transcript, label: "View transcript" }, attributesHtml: 'data-popular-button data-action="cli-terminal#showTranscript"' })}${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Transcript, label: "Back to terminal" }, attributesHtml: 'data-popular-button data-action="cli-terminal#showTerminal"' })}</div>`;
}

export function cliTranscriptRoutes(adapter: CliAgentAdapter, sessions: CliSessions) {
  return async (request: Request, url: URL): Promise<Response | undefined> => {
    const match = url.pathname.match(/^\/workspaces\/([^/]+)\/([^/]+)-agents\/([^/]+)\/transcript(?:\/(transcript-items|session-images)\/([^/]+)(?:\/(\d+))?)?$/);
    if (!match || match[2] !== adapter.id || request.method !== "GET" || !adapter.loadTranscript) return undefined;
    const workspaceId = decodeURIComponent(match[1]!);
    const conversationId = decodeURIComponent(match[3]!);
    await sessions.ready(workspaceId, conversationId);
    const ctx = context(workspaceId, conversationId, adapter.id);
    if (match[4] === "session-images") {
      if (!adapter.loadTranscriptImage || match[6] === undefined) return new Response("Not found", { status: 404 });
      return adapter.loadTranscriptImage(workspaceId, conversationId, decodeURIComponent(match[5]!), Number(match[6]));
    }
    const records = await adapter.loadTranscript(workspaceId, conversationId);
    if (match[4] === "transcript-items") {
      const count = Math.max(100, Math.min(100_000, Number(url.searchParams.get("count") ?? 100) || 100));
      const html = records && renderReadOnlyTranscriptDetail(ctx, records, decodeURIComponent(match[5]!), count);
      return new Response(html ?? "Not found", { status: html ? 200 : 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    const content = records?.length ? renderReadOnlyTranscript(ctx, records) : `<div class="cli-transcript-empty">No ${escapeHtml(adapter.label)} transcript is available yet. Return to the terminal and try again after a message.</div>`;
    return new Response(`<turbo-frame id="${escapeHtml(ids.transcript(ctx))}"><div class="agent-transcript-content">${content}</div></turbo-frame>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  };
}
