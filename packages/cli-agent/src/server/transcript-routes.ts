import { agentConversationKey, ids, renderReadOnlyTranscript, renderReadOnlyTranscriptDetail, subscribeWorkspaceAgentBusy, type AgentRenderContext } from "@agents-in-the-cloud/agent/server";
import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { renderFollowLatestButton } from "@agents-in-the-cloud/prompt/server";
import { escapeHtml, turboStream, type CableChannelAdapter } from "@agents-in-the-cloud/shared";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { response } from "@agents-in-the-cloud/shared/http";
import type { CliAgentAdapter } from "./adapter.ts";
import type { CliSessions } from "./sessions.ts";

type CliTranscriptContext = AgentRenderContext & { transcriptBasePath: string };
function context(workspaceId: string, conversationId: string, providerId: string): CliTranscriptContext {
  return { workspaceId, conversationId, transcriptBasePath: `/workspaces/${encodeURIComponent(workspaceId)}/${providerId}-agents/${encodeURIComponent(conversationId)}/transcript` };
}

/** Available: the transcript can stand in for the terminal. Never mid-turn, and only once there is something to read. */
function renderTranscriptContent(ctx: CliTranscriptContext, available: boolean, html = ""): string {
  return `<div id="${ids.transcript(ctx)}" class="agent-transcript-content" data-cli-terminal-target="transcriptContent" data-available="${available}">${html}</div>`;
}

export function renderCliTranscriptView(adapter: CliAgentAdapter, workspaceId: string, conversationId: string): string {
  if (!adapter.loadTranscript) return "";
  return `<div class="agent-transcript cli-transcript-view" data-cli-terminal-target="transcript" data-action="scroll->cli-terminal#transcriptScrolled">${renderTranscriptContent(context(workspaceId, conversationId, adapter.id), false)}</div>`;
}

export function cliTranscriptAttributes(adapter: CliAgentAdapter, conversationId: string): string {
  if (!adapter.loadTranscript) return "";
  return `data-cli-terminal-conversation-id-value="${escapeHtml(conversationId)}" data-cli-terminal-transcript-channel-value="${escapeHtml(cliTranscriptChannelName(adapter))}"`;
}

function cliTranscriptChannelName(adapter: CliAgentAdapter): string { return `${adapter.id}-transcript`; }

/** Publishes whether the transcript is available whenever the CLI starts or finishes a turn, with the transcript itself for panes showing it. */
export function cliTranscriptChannel(adapter: CliAgentAdapter, sessions: CliSessions): CableChannelAdapter {
  // Agent keys name conversations, which are unique across workspaces.
  const busy = new Set<string>();
  const watchers = new Set<{ agentKey: string; changed(): void }>();
  subscribeWorkspaceAgentBusy(({ agentKey, busy: started }) => {
    if (started) busy.add(agentKey); else busy.delete(agentKey);
    for (const watcher of watchers) if (watcher.agentKey === agentKey) watcher.changed();
  });
  async function render(workspaceId: string, conversationId: string, includeTranscript: boolean): Promise<string> {
    // The transcript is only shown between turns, so every turn in it has finished.
    const records = busy.has(agentConversationKey(conversationId)) ? undefined : await adapter.loadTranscript!(workspaceId, conversationId);
    const available = records?.some((record) => record.kind === "user") ?? false;
    const ctx = context(workspaceId, conversationId, adapter.id);
    return turboStream("replace", ids.transcript(ctx), renderTranscriptContent(ctx, available, includeTranscript && available ? renderReadOnlyTranscript(ctx, records!) : ""));
  }
  return {
    name: cliTranscriptChannelName(adapter),
    async subscribe(identifier, listener) {
      if (identifier.channel !== "module" || identifier.name !== cliTranscriptChannelName(adapter)) throw new Error(`Invalid ${adapter.label} transcript channel`);
      const { conversationId, transcript } = Value.Parse(Type.Object({ conversationId: Type.String({ minLength: 1 }), transcript: Type.Optional(Type.Literal("shown")) }, { additionalProperties: false }), identifier.params);
      const workspaceId = identifier.workspaceId;
      await sessions.ready(workspaceId, conversationId);
      const publish = async () => listener(await render(workspaceId, conversationId, transcript !== undefined));
      // Turn boundaries can arrive while the transcript loads; publish each in order.
      let latest = publish();
      const watcher = { agentKey: agentConversationKey(conversationId), changed() { latest = latest.then(publish); } };
      watchers.add(watcher);
      try { await latest; } catch (error) { watchers.delete(watcher); throw error; }
      return { unsubscribe: () => { watchers.delete(watcher); } };
    },
  };
}

/** The view switch (terminal ↔ transcript) and the transcript's follow latest, for the floating stack. */
interface CliTranscriptControls { viewSwitch?: string; followLatest?: string }

export function renderCliTranscriptControls(adapter: CliAgentAdapter): CliTranscriptControls {
  if (!adapter.loadTranscript) return {};
  return {
    viewSwitch: `${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Transcript, label: "View transcript" }, attributesHtml: 'data-popular-button data-action="cli-terminal#showTranscript" title="View transcript (⌘⌥P)" aria-keyshortcuts="Meta+Alt+P"' })}${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Terminal, label: "Back to terminal" }, attributesHtml: 'data-popular-button data-action="cli-terminal#showTerminal" title="Back to terminal (⌘⌥P)" aria-keyshortcuts="Meta+Alt+P"' })}`,
    followLatest: renderFollowLatestButton('data-cli-terminal-target="transcriptEnd" data-action="cli-terminal#scrollToTranscriptEnd"'),
  };
}

export function cliTranscriptRoutes(adapter: CliAgentAdapter, sessions: CliSessions) {
  return async (request: Request, url: URL): Promise<Response | undefined> => {
    const match = url.pathname.match(/^\/workspaces\/([^/]+)\/([^/]+)-agents\/([^/]+)\/transcript\/(transcript-items|session-images)\/([^/]+)(?:\/(\d+))?$/);
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
    const count = Math.max(100, Math.min(100_000, Number(url.searchParams.get("count") ?? 100) || 100));
    const html = records && renderReadOnlyTranscriptDetail(ctx, records, decodeURIComponent(match[5]!), count);
    return response(html ?? "Not found", { status: html ? 200 : 404 });
  };
}
