import { renderWorkspaceCompletionCatalog } from "@atelier/agent/server";
import { agentAttachmentDraftId, listStagedAttachments, renderComposerBody, renderOpenComposerButton, agentComposerActions, composerAttachmentAttributes } from "@atelier/prompt/server";
import { transcriptionComposerController } from "@atelier/transcription/server";
import { observableTerminalStaticFiles, renderTerminalConnectionStatus } from "@atelier/observable-terminal/server";
import { domId, escapeHtml, type WorkspaceModule } from "@atelier/shared";
import type { AtelierEventBus } from "@atelier/core";
import type { CliAgentAdapter } from "./adapter.ts";
import { createCliSessions } from "./sessions.ts";
import { cliSocketHandler } from "./sockets.ts";
import { cliComposerRoutes } from "./composer-routes.ts";
import { cliTranscriptRoutes, renderCliTranscriptSwitch } from "./transcript-routes.ts";

export type { CliAgentAdapter, CliAgentSession } from "./adapter.ts";

function terminalStatus(terminal: { ended: boolean; exitCode?: number }): string {
  return terminal.ended ? `Session ended${terminal.exitCode ? ` (exit ${terminal.exitCode}). See terminal output for details.` : ""}` : "";
}

/** One adapter supplies CLI policy; this module owns the complete terminal-agent lifecycle. */
export function createCliAgentModule(adapter: CliAgentAdapter): WorkspaceModule {
  let events: AtelierEventBus;
  const sessions = createCliSessions(adapter, (workspaceId, conversationId, title) => events.emit("workspace_agent_conversation_title_changed", { workspaceId, conversationId, title }));
  function failureStatus(error: string) { return `Could not start ${escapeHtml(adapter.label)}: ${escapeHtml(error)}`; }
  return {
    id: `${adapter.id}-agent`,
    staticFiles: {
      ...observableTerminalStaticFiles,
      "/cli-agent.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" },
    },
    initialize(context) {
      events = context.events;
      context.registerSocketHandler(cliSocketHandler(adapter.id, sessions));
      context.events.on("workspace_agent_turn_finished", ({ workspaceId, conversationId }) => {
        if (sessions.list(workspaceId).some((session) => session.id === conversationId)) {
          void sessions.exportHistory(workspaceId, conversationId).catch((error) => console.error(`Could not export ${adapter.label} session ${conversationId}`, error));
        }
      });
      context.events.on("workspace_deleting", async ({ workspaceId }) => {
        await sessions.exportWorkspaceHistory(workspaceId);
      });
    },
    routes: [{ handle: cliComposerRoutes(adapter.id, sessions) }, { handle: cliTranscriptRoutes(adapter, sessions) }],
    agentProvider: {
      id: adapter.id, label: adapter.label, iconHtml: adapter.iconHtml,
      async create({ workspaceId }) {
        await adapter.requireSetup();
        return sessions.create(workspaceId, await adapter.settings.prepare());
      },
      tabs: {
        async list({ workspaceId }) { return sessions.list(workspaceId).map(({ id, title }) => ({ id, title })); },
        async render({ workspaceId, conversationId }) {
          const session = await sessions.ready(workspaceId, conversationId);
          const terminal = await sessions.terminalState(workspaceId, session);
          const url = `/workspaces/${encodeURIComponent(workspaceId)}/${adapter.id}-agents/${encodeURIComponent(conversationId)}`;
          const draftId = agentAttachmentDraftId(workspaceId, `${adapter.id}:${conversationId}`);
          const rowId = domId("cli_attach", workspaceId, conversationId);
          const composerUrl = `${url}/composer`;
          const composer = terminal.exists && !terminal.ended ? `<div class="composer cli-agent-composer" data-controller="agent-completions ${transcriptionComposerController}" data-action="agent-composer:send-prompt->cli-terminal#sendPrompt" data-agent-completions-url-value="${escapeHtml(composerUrl)}/completions" data-transcription-composer-workspace-id-value="${escapeHtml(workspaceId)}">
            <div class="composer-surface">
              <form id="${domId("cli_composer_form", workspaceId, conversationId)}" method="post" action="${escapeHtml(composerUrl)}" data-turbo="false" data-cli-terminal-target="form" data-action="submit->transcription-composer#submit keydown->agent-completions#keydown submit->cli-terminal#submit">
                ${renderComposerBody({
                  draft: { id: draftId, rowId, attachments: await listStagedAttachments(draftId) },
                  collapsible: true,
                  inputHtml: `<textarea class="composer-input" name="text" rows="2" enterkeyhint="send" placeholder="Write your prompt here" aria-label="CLI agent prompt" data-controller="composer-send-hint" data-cli-terminal-target="input" data-agent-completions-target="input" data-action="input->agent-completions#input keydown->cli-terminal#inputKeydown paste->agent-attachments#paste"></textarea>`,
                })}
              </form>
              <div class="agent-completion-menu-host" data-agent-completions-target="menu" hidden></div>
              <div data-agent-completions-target="catalog" hidden>${await renderWorkspaceCompletionCatalog(workspaceId, "cli")}</div>
            </div>
          </div>` : "";
          return `<section id="${domId("cli_agent", workspaceId, conversationId)}" data-turbo-permanent class="cli-agent-body agent-composer-pane" data-controller="cli-terminal agent-composer composer-focus${composer ? " agent-attachments" : ""}" data-cli-terminal-url-value="${escapeHtml(url)}" data-cli-terminal-workspace-id-value="${escapeHtml(workspaceId)}" ${composerAttachmentAttributes(draftId, rowId, `atelier:workspace-pane-visible@window->cli-terminal#refresh atelier:workspace-agent-focus->cli-terminal#focus atelier:theme-change@document->cli-terminal#theme ${agentComposerActions}`)}>
            <div class="cli-terminal-status" role="status">${session.error ? failureStatus(session.error) : terminalStatus(terminal)}</div>
            <div class="cli-agent-stage">
              ${terminal.exists ? renderTerminalConnectionStatus("cli-terminal") : ""}
              ${terminal.exists ? '<div class="observable-terminal-host" data-cli-terminal-target="terminal" tabindex="0" data-action="pointerdown->cli-terminal#terminalPointer:capture pointermove->cli-terminal#terminalPointer:capture pointerup->cli-terminal#terminalPointer:capture keydown->cli-terminal#resumeInput:capture beforeinput->cli-terminal#resumeInput:capture touchstart->cli-terminal#startTerminalTouch:passive touchmove->cli-terminal#moveTerminalTouch:!passive touchcancel->cli-terminal#cancelTerminalTouch touchend->cli-terminal#finishTerminalTouch:!passive"></div>' : ""}
              ${renderCliTranscriptSwitch(adapter, workspaceId, conversationId)}
            </div>
            ${composer ? renderOpenComposerButton() : ""}
            ${composer}
          </section>`;
        },
        close: ({ workspaceId, conversationId }) => sessions.close(workspaceId, conversationId),
      },
      launch: {
        renderFooter: adapter.settings.renderFooter,
        async prepare(parameters) { await adapter.requireSetup(); return { agent: await adapter.settings.prepare(parameters) }; },
        async submit(form) {
          await adapter.requireSetup();
          const settings = await adapter.settings.prepare({ model: String(form.get("model") ?? ""), thinkingLevel: String(form.get("level") ?? "") });
          return { async prepare() { return { agent: settings }; } };
        },
        prepareWorkspace: (workspaceId, context) => sessions.prepareWorkspace(workspaceId, context?.agent),
      },
    },
  };
}

export { createCliModelSettings, type CliModelSettings } from "./model-settings.ts";
export { cliLaunchScript, writeFileScript } from "./launch-script.ts";
export { turnSignalArgv, turnSignalShell, type TurnBoundary } from "./turn-signal.ts";
export { syntaxSlot, transcriptSlot } from "./transcript-palette.ts";
export { nativeJsonlFiles } from "./history.ts";
export { nativeJsonlRows, nativeJsonlText, nativeImageTypes, nativeImageResponse } from "./native-transcript.ts";
