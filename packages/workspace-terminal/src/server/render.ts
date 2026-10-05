import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { renderTerminalConnectionStatus, renderTerminalKeyBar } from "@agents-in-the-cloud/observable-terminal/server";
import { domId, escapeHtml } from "@agents-in-the-cloud/shared";
import { terminalViewKey } from "../shared.ts";
import type { WorkspaceTerminal } from "./workspace-terminals.ts";

export function renderTerminalPane(workspaceId: string, terminal: WorkspaceTerminal): string {
  const base = `/workspaces/${encodeURIComponent(workspaceId)}`;
  const action = (url: string, caption: string, variant: "primary" | "secondary") => `<form method="post" action="${escapeHtml(url)}" data-turbo="true">${buttonHtml({ type: "submit", variant, content: { kind: "caption", caption } })}</form>`;
  const ended = `<div class="terminal-ended" data-terminal-pane-target="ended" hidden role="status" aria-live="polite">
    <strong>This terminal session has ended</strong>
    <p>The tmux session “${escapeHtml(terminal.tmuxSession)}” no longer exists.</p>
    <div class="terminal-ended-actions">
      ${action(`${base}/work-views/${encodeURIComponent(JSON.stringify({ type: "terminal", terminalId: terminal.id }))}/close`, "Close tab", "secondary")}
    </div>
  </div>`;
  return `<section id="${domId("terminal_pane", workspaceId, terminal.id)}" data-turbo-permanent class="terminal-work-view" data-work-view-source="${escapeHtml(terminalViewKey(terminal.id))}">
    <div class="terminal-pane" data-controller="terminal-pane" data-action="agents-in-the-cloud:theme-change@document->terminal-pane#theme" data-terminal-pane-workspace-id-value="${escapeHtml(workspaceId)}" data-terminal-pane-id-value="${escapeHtml(terminal.id)}" data-terminal-id="${escapeHtml(terminal.id)}">
      ${ended}
      <div class="terminal-stage" data-terminal-pane-target="stage">
      ${renderTerminalConnectionStatus("terminal-pane")}
      <div class="observable-terminal-host" data-terminal-pane-target="host" tabindex="0" data-action="pointerdown->terminal-pane#dragPointer:capture
        pointermove->terminal-pane#dragPointer:capture
        pointerup->terminal-pane#dragPointer:capture
        pointercancel->terminal-pane#dragPointer:capture
        lostpointercapture->terminal-pane#dragPointer:capture
        keydown->terminal-pane#allowNativePaste:capture
        touchstart->terminal-pane#startTerminalTouch:passive
        touchmove->terminal-pane#moveTerminalTouch:passive
        touchcancel->terminal-pane#cancelTerminalTouch
        touchend->terminal-pane#finishTerminalTouch:!passive">
        <div class="terminal-loading" role="status" aria-label="Loading terminal"><span class="activity-spinner" aria-hidden="true"></span></div>
      </div>
      </div>
      ${renderTerminalKeyBar("terminal-pane")}
    </div>
  </section>`;
}
