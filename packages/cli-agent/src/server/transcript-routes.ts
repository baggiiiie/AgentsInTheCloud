import { ids, renderReadOnlyTranscript, renderReadOnlyTranscriptDetail, type AgentRenderContext } from "@agents-in-the-cloud/agent/server";
import { actionLinkHtml } from "@agents-in-the-cloud/design-system/action-link";
import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { escapeHtml } from "@agents-in-the-cloud/shared";
import { response } from "@agents-in-the-cloud/shared/http";
import type { CliAgentAdapter } from "./adapter.ts";
import type { CliSessions } from "./sessions.ts";

type CliTranscriptContext = AgentRenderContext & { transcriptBasePath: string };
function context(workspaceId: string, conversationId: string, providerId: string): CliTranscriptContext {
  return { workspaceId, conversationId, transcriptBasePath: `/workspaces/${encodeURIComponent(workspaceId)}/${providerId}-agents/${encodeURIComponent(conversationId)}/transcript` };
}

export function renderCliTranscriptView(adapter: CliAgentAdapter, workspaceId: string, conversationId: string): string {
  if (!adapter.loadTranscript) return "";
  const ctx = context(workspaceId, conversationId, adapter.id);
  return `<turbo-frame id="${ids.transcript(ctx)}" class="agent-transcript cli-transcript-view" data-cli-terminal-target="transcript" data-action="turbo:frame-load->cli-terminal#transcriptLoaded scroll->cli-terminal#transcriptScrolled"></turbo-frame>`;
}

/** The terminal/transcript toggle and the transcript's scroll-to-bottom, for the floating button stack. */
interface CliTranscriptControls { toggle: string; scrollToBottom: string }

export function renderCliTranscriptControls(adapter: CliAgentAdapter, workspaceId: string, conversationId: string): CliTranscriptControls {
  if (!adapter.loadTranscript) return { toggle: "", scrollToBottom: "" };
  const ctx = context(workspaceId, conversationId, adapter.id);
  return {
    toggle: `${actionLinkHtml({ href: ctx.transcriptBasePath, variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Transcript, label: "View transcript" }, attributesHtml: `data-popular-button data-turbo-frame="${ids.transcript(ctx)}" data-action="cli-terminal#showTranscript" title="View transcript (⌘⌥P)" aria-keyshortcuts="Meta+Alt+P"` })}${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Terminal, label: "Back to terminal" }, attributesHtml: 'data-popular-button data-action="cli-terminal#showTerminal" title="Back to terminal (⌘⌥P)" aria-keyshortcuts="Meta+Alt+P"' })}`,
    scrollToBottom: buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16h12M10 4v9m-4-4 4 4 4-4"/></svg>', label: "Follow latest" }, attributesHtml: 'data-popular-button data-cli-terminal-target="transcriptEnd" data-action="cli-terminal#scrollToTranscriptEnd" hidden' }),
  };
}

export function cliTranscriptRoutes(adapter: CliAgentAdapter, sessions: CliSessions) {
  return async (request: Request, url: URL): Promise<Response | undefined> => {
    const match = url.pathname.match(/^\/workspaces\/([^/]+)\/([^/]+)-agents\/([^/]+)\/transcript(?:\/(transcript-items|session-images)\/([^/]+)(?:\/(\d+))?)?$/);
    if (!match || match[2] !== adapter.id || request.method !== "GET" || !adapter.loadTranscript) return undefined;
    const workspaceId = decodeURIComponent(match[1]!);
    const conversationId = decodeURIComponent(match[3]!);
    const session = await sessions.ready(workspaceId, conversationId);
    const ctx = context(workspaceId, conversationId, adapter.id);
    if (match[4] === "session-images") {
      if (!adapter.loadTranscriptImage || match[6] === undefined) return new Response("Not found", { status: 404 });
      return adapter.loadTranscriptImage(workspaceId, conversationId, decodeURIComponent(match[5]!), Number(match[6]));
    }
    const records = await adapter.loadTranscript(workspaceId, conversationId);
    const terminal = await sessions.terminalState(workspaceId, session);
    const openEnded = terminal.exists && !terminal.ended;
    if (match[4] === "transcript-items") {
      const count = Math.max(100, Math.min(100_000, Number(url.searchParams.get("count") ?? 100) || 100));
      const html = records && renderReadOnlyTranscriptDetail(ctx, records, decodeURIComponent(match[5]!), count, openEnded);
      return response(html ?? "Not found", { status: html ? 200 : 404 });
    }
    const content = records?.length ? renderReadOnlyTranscript(ctx, records, openEnded) : `<div class="cli-transcript-empty">No ${escapeHtml(adapter.label)} transcript is available yet. Return to the terminal and try again after a message.</div>`;
    return response(`<turbo-frame id="${escapeHtml(ids.transcript(ctx))}"><div class="agent-transcript-content">${content}</div></turbo-frame>`);
  };
}
