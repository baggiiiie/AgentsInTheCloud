import { prepareAgentMcp, revokeAgentMcp, suggestSessionSlug } from "@agents-in-the-cloud/agent/server";
import { parseModelRef } from "@agents-in-the-cloud/llm/server";
import { exportCliHistory } from "./history.ts";
import { AgentsInTheCloudCoreError, createKeyedOperationQueue, shellQuote } from "@agents-in-the-cloud/core";
import { buildObservableSessionCommand } from "@agents-in-the-cloud/observable-terminal/server";
import { imageMimeByExtension } from "@agents-in-the-cloud/prompt/server";
import type { AgentWorkspaceParameters, WorkspaceAgentInput } from "@agents-in-the-cloud/shared";
import { createWorkspaceMetadataState, execWorkspaceShell, workspaceRoot } from "@agents-in-the-cloud/workspace";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { CliAgentAdapter, CliAgentSession } from "./adapter.ts";

const inputSchema = Type.Object({ text: Type.String(), images: Type.Array(Type.Object({ mimeType: Type.String(), data: Type.String() })), attachmentNotes: Type.Array(Type.String()) });
const sessionSchema = Type.Object({
  id: Type.String(), title: Type.String(), tmuxSession: Type.String(), input: inputSchema,
  // Older Codex tabs have no kind. Reading them must never execute their saved prompts.
  kind: Type.Optional(Type.String()), error: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()), thinkingLevel: Type.Optional(Type.String()),
  historySlug: Type.Optional(Type.String()),
});
const stateSchema = Type.Object({ sessions: Type.Array(sessionSchema) });
type CliSession = Static<typeof sessionSchema>;

export async function checkedWorkspaceShell(workspaceId: string, command: string, stdin?: string): Promise<void> {
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
    if (!session) throw new AgentsInTheCloudCoreError("agent_conversation_not_found", `${adapter.label} conversation not found: ${id}`);
    return session;
  }

  // Called only inside the workspace queue, including the provisioning claim check.
  async function launch(workspaceId: string, input: WorkspaceAgentInput, settings: AgentWorkspaceParameters): Promise<string> {
    await adapter.requireSetup();
    const id = crypto.randomUUID();
    const session: CliSession = { id, title: adapter.label, tmuxSession: `${adapter.id}-${id}`, input, kind: adapter.id, model: settings.model, thinkingLevel: settings.thinkingLevel };
    // Claim before side effects. Recovery must never submit the initial prompt twice.
    store().write(workspaceId, { sessions: [...list(workspaceId), session] });
    await start(workspaceId, session, settings, input);
    if (!session.error && input.text.trim()) void nameFromPrompt(workspaceId, session).catch((error) => console.error(`Could not publish ${adapter.label} session title ${id}`, error));
    return id;
  }

  async function start(workspaceId: string, session: CliSession, settings: AgentWorkspaceParameters, input?: WorkspaceAgentInput): Promise<void> {
    const { id } = session;
    const ready = Promise.withResolvers<void>();
    starting.set(id, ready.promise);
    try {
      await adapter.prepareWorkspace?.(workspaceId);
      const directory = `/tmp/agents-in-the-cloud-attachments/${adapter.id}-${id}`;
      const imagePaths: string[] = [];
      for (const [index, image] of (input?.images ?? []).entries()) {
        const extension = Object.entries(imageMimeByExtension).find(([, mime]) => mime === image.mimeType)?.[0];
        if (!extension) throw new Error(`Unsupported image type: ${image.mimeType}`);
        const path = `${directory}/${index}.${extension}`;
        await checkedWorkspaceShell(workspaceId, `mkdir -p ${shellQuote(directory)} && base64 -d > ${shellQuote(path)}`, image.data);
        imagePaths.push(path);
      }
      const mcp = await prepareAgentMcp(workspaceId, id);
      const sessionDirectory = `/home/agents-in-the-cloud/.local/share/agents-in-the-cloud-agents/${id}`;
      const turnSignalCommand = `${sessionDirectory}/turn-signal.sh`;
      const launchSession: CliAgentSession = { id, directory: sessionDirectory, turnSignalCommand };
      // $1 is the TurnBoundary the CLI reports.
      await checkedWorkspaceShell(workspaceId, `umask 077; mkdir -p ${shellQuote(sessionDirectory)} && cat > ${shellQuote(turnSignalCommand)}`, `#!/bin/sh
exec curl --noproxy '*' --fail --silent --show-error --max-time 10 -X POST -H ${shellQuote("Authorization: Bearer " + mcp.token)} ${shellQuote(new URL("/agent-turn-", mcp.url).href)}"$1"
`);
      const env = { HOME: "/home/agents-in-the-cloud", ...await adapter.prepareSession?.(workspaceId, launchSession, mcp) };
      const script = input
        ? adapter.launchScript(input, imagePaths, settings, launchSession)
        : await adapter.resumeScript!(workspaceId, settings, launchSession);
      const command = `/bin/bash -c ${shellQuote(script)}`;
      await checkedWorkspaceShell(workspaceId, buildObservableSessionCommand({ requireExistingServer: true, session: session.tmuxSession, cwd: workspaceRoot, command, env, remainOnExit: true, passthrough: true, historyLimit: 10000 }));
      delete session.error;
      store().write(workspaceId, { sessions: list(workspaceId) });
    } catch (error) {
      // Startup failure is durable session state, shown in its tab rather than discarded.
      session.error = error instanceof Error ? error.message : String(error);
      store().write(workspaceId, { sessions: list(workspaceId) });
      await revokeAgentMcp(workspaceId, id);
    } finally {
      starting.delete(id);
      ready.resolve();
    }
  }

  function restoreWorkspace(workspaceId: string): Promise<void> {
    return serialize(workspaceId, async () => {
      if (!adapter.resumeScript) return;
      for (const session of list(workspaceId)) {
        // Legacy placeholders are not runnable sessions. Existing (including dead)
        // panes belong to the current runtime and must not be relaunched.
        if (session.kind !== adapter.id || (await terminalState(workspaceId, session)).exists) continue;
        await start(workspaceId, session, { model: session.model, thinkingLevel: session.thinkingLevel });
      }
    });
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
  async function terminalState(workspaceId: string, session: CliSession): Promise<{ starting?: boolean; exists: boolean; ended: boolean; exitCode?: number }> {
    if (starting.has(session.id)) return { starting: true, exists: false, ended: false };
    const result = await execWorkspaceShell(workspaceId, `tmux list-panes -t ${shellQuote(session.tmuxSession)} -F '#{pane_dead}:#{pane_dead_status}'`);
    if (result.exitCode === 1) return { exists: false, ended: true };
    if (result.exitCode !== 0) throw new AgentsInTheCloudCoreError(`${adapter.id}_session_check_failed`, result.stderr.trim() || `Could not inspect ${adapter.label} terminal`);
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
      if ((await terminalState(workspaceId, session)).exists) await checkedWorkspaceShell(workspaceId, `tmux kill-session -t ${shellQuote(session.tmuxSession)}`);
      store().write(workspaceId, { sessions: list(workspaceId).filter((session) => session.id !== id) });
    });
  }
  async function exportWorkspaceHistory(workspaceId: string): Promise<void> {
    for (const session of list(workspaceId)) await exportHistory(workspaceId, session.id);
  }
  return { list, get, ready, create, prepareWorkspace, restoreWorkspace, terminalState, recordNamingPrompt, suggestTitle, setTitle, close, exportHistory, exportWorkspaceHistory };
}

export type CliSessions = ReturnType<typeof createCliSessions>;
