import { dirname } from "node:path";
import { prepareAgentMcp, revokeAgentMcp, suggestSessionSlug } from "@atelier/agent/server";
import { parseModelRef } from "@atelier/llm/server";
import { exportCliHistory } from "./history.ts";
import { AtelierCoreError, createKeyedOperationQueue, shellQuote } from "@atelier/core";
import { buildObservableSessionCommand } from "@atelier/observable-terminal/server";
import { imageMimeByExtension } from "@atelier/prompt/server";
import type { AgentWorkspaceParameters, WorkspaceAgentInput } from "@atelier/shared";
import { createWorkspaceMetadataState, execWorkspaceShell, workspaceRoot } from "@atelier/workspace";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { CliAgentAdapter, CliAgentSession } from "./adapter.ts";

const inputSchema = Type.Object({ text: Type.String(), images: Type.Array(Type.Object({ mimeType: Type.String(), data: Type.String() })), attachmentNotes: Type.Array(Type.String()) });
const sessionSchema = Type.Object({
  id: Type.String(), title: Type.String(), tmuxSession: Type.String(), input: inputSchema,
  // Older Codex tabs have no kind. Reading them must never execute their saved prompts.
  kind: Type.Optional(Type.String()), error: Type.Optional(Type.String()),
  firstPresentation: Type.Optional(Type.Boolean()),
  model: Type.Optional(Type.String()), thinkingLevel: Type.Optional(Type.String()),
  historySlug: Type.Optional(Type.String()),
});
const stateSchema = Type.Object({ sessions: Type.Array(sessionSchema) });
type CliSession = Static<typeof sessionSchema>;

async function checkedShell(workspaceId: string, command: string, stdin?: string): Promise<void> {
  const result = await execWorkspaceShell(workspaceId, command, { stdin });
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Command failed (exit ${result.exitCode})`);
}

export function createCliSessions(adapter: CliAgentAdapter, onTitleChanged: (workspaceId: string, id: string, title: string) => Promise<void>) {
  let state: ReturnType<typeof createStore> | undefined;
  function createStore() { return createWorkspaceMetadataState(`${adapter.id}-agents.json`, (value) => Value.Parse(stateSchema, value), () => ({ sessions: [] })); }
  function store() { return state ??= createStore(); }
  const serialize = createKeyedOperationQueue();
  // Runtime readiness is separate from the durable claim. After a host restart,
  // inspect tmux; never replay a claimed initial prompt.
  const starting = new Map<string, Promise<void>>();

  function list(workspaceId: string): CliSession[] { return store().read(workspaceId).sessions; }
  function get(workspaceId: string, id: string): CliSession {
    const session = list(workspaceId).find((session) => session.id === id);
    if (!session) throw new AtelierCoreError("agent_conversation_not_found", `${adapter.label} conversation not found: ${id}`);
    return session;
  }

  // Called only inside the workspace queue, including the provisioning claim check.
  async function launch(workspaceId: string, input: WorkspaceAgentInput, settings: AgentWorkspaceParameters): Promise<string> {
    await adapter.requireSetup();
    const id = crypto.randomUUID();
    const session: CliSession = { id, title: adapter.label, tmuxSession: `${adapter.id}-${id}`, input, kind: adapter.id, model: settings.model, thinkingLevel: settings.thinkingLevel, firstPresentation: !input.text.trim() && !input.images.length && !input.attachmentNotes.length };
    // Claim before side effects. Recovery must never submit the initial prompt twice.
    store().write(workspaceId, { sessions: [...list(workspaceId), session] });
    const ready = Promise.withResolvers<void>();
    starting.set(id, ready.promise);
    try {
      await adapter.prepareWorkspace?.(workspaceId);
      const directory = `/tmp/atelier-attachments/${adapter.id}-${id}`;
      const imagePaths: string[] = [];
      for (const [index, image] of input.images.entries()) {
        const extension = Object.entries(imageMimeByExtension).find(([, mime]) => mime === image.mimeType)?.[0];
        if (!extension) throw new Error(`Unsupported image type: ${image.mimeType}`);
        const path = `${directory}/${index}.${extension}`;
        await checkedShell(workspaceId, `mkdir -p ${shellQuote(directory)} && base64 -d > ${shellQuote(path)}`, image.data);
        imagePaths.push(path);
      }
      const mcp = await prepareAgentMcp(workspaceId, id);
      const turnSignalCommand = `/home/atelier/.local/share/atelier-agents/${id}/turn-signal.sh`;
      const launchSession: CliAgentSession = { id, turnSignalCommand };
      // $1 is the TurnBoundary the CLI reports.
      await checkedShell(workspaceId, `umask 077; mkdir -p ${shellQuote(dirname(turnSignalCommand))} && cat > ${shellQuote(turnSignalCommand)}`, `#!/bin/sh
exec curl --noproxy '*' --fail --silent --show-error --max-time 10 -X POST -H ${shellQuote("Authorization: Bearer " + mcp.token)} ${shellQuote(new URL("/agent-turn-", mcp.url).href)}"$1"
`);
      const env = { HOME: "/home/atelier", ...await adapter.prepareSession?.(workspaceId, launchSession, mcp) };
      const command = `/bin/bash -c ${shellQuote(adapter.launchScript(input, imagePaths, settings, launchSession))}`;
      await checkedShell(workspaceId, buildObservableSessionCommand({ requireExistingServer: true, session: session.tmuxSession, cwd: workspaceRoot, command, env, remainOnExit: true, passthrough: true, historyLimit: 10000 }));
    } catch (error) {
      // Startup failure is durable session state, shown in its tab rather than discarded.
      session.error = error instanceof Error ? error.message : String(error);
      store().write(workspaceId, { sessions: list(workspaceId) });
      await revokeAgentMcp(workspaceId, id);
    } finally {
      starting.delete(id);
      ready.resolve();
    }
    if (!session.error && input.text.trim()) void nameFromPrompt(workspaceId, session).catch((error) => console.error(`Could not publish ${adapter.label} session title ${id}`, error));
    return id;
  }

  async function suggestSlug(session: CliSession): Promise<string | undefined> {
    try {
      return await suggestSessionSlug(session.input.text, session.model ? parseModelRef(session.model) : undefined);
    } catch (error) {
      console.error(`Could not name ${adapter.label} session ${session.id}`, error);
      return undefined;
    }
  }

  async function applyTitle(workspaceId: string, id: string, title: string, onlyIfUntitled: boolean): Promise<void> {
    const changed = await serialize(workspaceId, async () => {
      const session = list(workspaceId).find((item) => item.id === id);
      if (!session && onlyIfUntitled) return false;
      const current = session ?? get(workspaceId, id);
      if (onlyIfUntitled && (current.title !== adapter.label || current.historySlug)) return false;
      current.title = title;
      current.historySlug = title;
      store().write(workspaceId, { sessions: list(workspaceId) });
      return true;
    });
    if (changed) await onTitleChanged(workspaceId, id, title);
  }

  // The launch prompt names the tab; the same slug later names the exported history.
  async function nameFromPrompt(workspaceId: string, session: CliSession): Promise<void> {
    const slug = await suggestSlug(session);
    if (slug) await applyTitle(workspaceId, session.id, slug, true);
  }

  function setTitle(workspaceId: string, id: string, title: string): Promise<void> {
    return applyTitle(workspaceId, id, title, false);
  }

  function suggestTitle(workspaceId: string, id: string): Promise<string | undefined> {
    return suggestSlug(get(workspaceId, id));
  }

  function create(workspaceId: string, settings: AgentWorkspaceParameters = {}): Promise<string> {
    return serialize(workspaceId, () => launch(workspaceId, settings.input ?? { text: "", images: [], attachmentNotes: [] }, settings));
  }
  function prepareWorkspace(workspaceId: string, settings: AgentWorkspaceParameters = {}): Promise<void> {
    return serialize(workspaceId, async () => {
      if (!list(workspaceId).length) await launch(workspaceId, settings.input ?? { text: "", images: [], attachmentNotes: [] }, settings);
    });
  }
  async function ready(workspaceId: string, id: string): Promise<CliSession> {
    get(workspaceId, id);
    await starting.get(id);
    return get(workspaceId, id);
  }
  function acknowledgeFirstPresentation(workspaceId: string, id: string): void {
    const session = get(workspaceId, id);
    if (!session.firstPresentation) return;
    session.firstPresentation = false;
    store().write(workspaceId, { sessions: list(workspaceId) });
  }
  async function terminalState(workspaceId: string, session: CliSession): Promise<{ starting?: boolean; exists: boolean; ended: boolean; exitCode?: number }> {
    if (starting.has(session.id)) return { starting: true, exists: false, ended: false };
    const result = await execWorkspaceShell(workspaceId, `tmux list-panes -t ${shellQuote(session.tmuxSession)} -F '#{pane_dead}:#{pane_dead_status}'`);
    if (result.exitCode === 1) return { exists: false, ended: true };
    if (result.exitCode !== 0) throw new AtelierCoreError(`${adapter.id}_session_check_failed`, result.stderr.trim() || `Could not inspect ${adapter.label} terminal`);
    const [dead, status] = result.stdout.trim().split(":");
    return { exists: true, ended: dead === "1", exitCode: status ? Number(status) : undefined };
  }
  async function recordNamingPrompt(workspaceId: string, id: string, text: string): Promise<void> {
    await serialize(workspaceId, async () => {
      const session = get(workspaceId, id);
      if (session.input.text.trim()) return;
      session.input = { ...session.input, text };
      store().write(workspaceId, { sessions: list(workspaceId) });
    });
  }
  async function exportHistory(workspaceId: string, id: string): Promise<void> {
    if (!["pi", "codex", "claude"].includes(adapter.id)) return;
    await serialize(workspaceId, async () => {
      const session = list(workspaceId).find((item) => item.id === id);
      if (!session || session.error) return;
      if (!session.historySlug) {
        session.historySlug = await suggestSlug(session);
        if (!session.historySlug) return;
        store().write(workspaceId, { sessions: list(workspaceId) });
      }
      await exportCliHistory(workspaceId, adapter.id, session.id, session.historySlug);
    });
  }
  async function close(workspaceId: string, id: string): Promise<void> {
    await exportHistory(workspaceId, id);
    await serialize(workspaceId, async () => {
      const session = get(workspaceId, id);
      await revokeAgentMcp(workspaceId, id);
      if ((await terminalState(workspaceId, session)).exists) await checkedShell(workspaceId, `tmux kill-session -t ${shellQuote(session.tmuxSession)}`);
      store().write(workspaceId, { sessions: list(workspaceId).filter((session) => session.id !== id) });
    });
  }
  async function exportWorkspaceHistory(workspaceId: string): Promise<void> {
    for (const session of list(workspaceId)) await exportHistory(workspaceId, session.id);
  }
  return { list, get, ready, create, prepareWorkspace, acknowledgeFirstPresentation, terminalState, recordNamingPrompt, suggestTitle, setTitle, close, exportHistory, exportWorkspaceHistory };
}

export type CliSessions = ReturnType<typeof createCliSessions>;
