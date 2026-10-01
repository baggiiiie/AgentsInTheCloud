import { copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createKeyedOperationQueue, getAtelierRuntimeContext } from "@atelier/core";
import type { GitProjectInitInstruction } from "@atelier/projects";
import { isGitProjectInit } from "@atelier/projects";
import type { WorkspaceInitInstruction } from "@atelier/workspace";
import { Type } from "typebox";
import { Value } from "typebox/value";

export interface WorkspaceAgentConversationInfo {
  workspaceId: string;
  conversationId: string;
  label: string;
  title: string;
  path: string;
  storage?: "durable";
}

// Unprefixed files are historical built-in sessions written before the provider prefix.
const sharedAgentFilePattern = /^(?:builtin--)?([a-z0-9][a-z0-9-]*)--([a-zA-Z0-9][a-zA-Z0-9_.-]*)--agent-([1-9]\d*)--([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.jsonl$/;
export const projectlessSessionShareKey = "projectless";
export const sessionShareMountPath = "/atelier/session-share";
export const untitledAgentConversationTitle = "Untitled";
const serializeConversationOperation = createKeyedOperationQueue();

function workspaceMetadataInitPath(workspaceId: string, dataDir = getAtelierRuntimeContext().atelierDataDir): string {
  return join(dataDir, "workspaces", workspaceId, "metadata", "init.json");
}

async function workspaceProjectInit(workspaceId: string, dataDir = getAtelierRuntimeContext().atelierDataDir): Promise<GitProjectInitInstruction | undefined> {
  const file = Bun.file(workspaceMetadataInitPath(workspaceId, dataDir));
  if (!(await file.exists())) return undefined;
  const init: unknown = JSON.parse(await file.text());
  return isGitProjectInit(init) ? init : undefined;
}

function sessionSlug(value: string, maxLength: number, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function sessionShareKeySlug(value: string): string {
  return sessionSlug(value, 80, projectlessSessionShareKey);
}

export function sessionShareKeyForInit(init: WorkspaceInitInstruction | undefined): string {
  if (!isGitProjectInit(init)) return projectlessSessionShareKey;
  const key = init.sessionShareKey.trim()
    ? init.sessionShareKey
    : init.name;
  return sessionShareKeySlug(key);
}

export async function workspaceSessionShareKey(workspaceId: string, dataDir = getAtelierRuntimeContext().atelierDataDir): Promise<string> {
  return sessionShareKeyForInit(await workspaceProjectInit(workspaceId, dataDir));
}

export function sessionShareDir(shareKey: string, dataDir = getAtelierRuntimeContext().atelierDataDir): string {
  return join(dataDir, "session-shares", sessionShareKeySlug(shareKey));
}

function sessionTopicSlug(value: string): string {
  return sessionSlug(value, 48, "agent-session");
}

function sharedAgentSessionFilename(workspaceId: string, label: string, title: string, conversationId: string): string {
  const number = Number(label.slice("Agent ".length));
  return `builtin--${sessionTopicSlug(title)}--${workspaceId}--agent-${number}--${conversationId}.jsonl`;
}

async function publishedSessionPath(agent: WorkspaceAgentConversationInfo): Promise<string> {
  return join(sessionShareDir(await workspaceSessionShareKey(agent.workspaceId)), sharedAgentSessionFilename(agent.workspaceId, agent.label, agent.title, agent.conversationId));
}

async function isLegacySharedSession(agent: WorkspaceAgentConversationInfo): Promise<boolean> {
  return agent.path.startsWith(sessionShareDir(await workspaceSessionShareKey(agent.workspaceId)) + "/");
}

export function parseWorkspaceAgentFilename(name: string, workspaceId?: string): { conversationId: string; label: string; number: number } | undefined {
  const projectMatch = name.match(sharedAgentFilePattern);
  if (projectMatch) {
    if (workspaceId !== undefined && projectMatch[2] !== workspaceId) return undefined;
    const number = Number(projectMatch[3]);
    return { conversationId: projectMatch[4]!, label: `Agent ${number}`, number };
  }

  return undefined;
}

async function touch(path: string): Promise<void> {
  const file = await open(path, "a");
  await file.close();
}

interface ConversationRecord { conversationId: string; label: string; title: string; storage?: "durable" }
const conversationsSchema = Type.Object({ conversations: Type.Array(Type.Object({ conversationId: Type.String(), label: Type.String(), title: Type.String(), storage: Type.Optional(Type.Literal("durable")) })) });
function conversationMetadataPath(workspaceId: string): string {
  return join(getAtelierRuntimeContext().atelierDataDir, "workspaces", workspaceId, "metadata", "agent-conversations.json");
}
function conversationSessionPath(workspaceId: string, conversationId: string): string {
  return join(getAtelierRuntimeContext().atelierDataDir, "workspaces", workspaceId, "agent-sessions", `${conversationId}.jsonl`);
}
async function conversationRecords(workspaceId: string): Promise<ConversationRecord[]> {
  const content = await readFile(conversationMetadataPath(workspaceId), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  return content ? Value.Parse(conversationsSchema, JSON.parse(content)).conversations : [];
}
async function saveConversationRecords(workspaceId: string, records: ConversationRecord[]): Promise<void> {
  const path = conversationMetadataPath(workspaceId);
  const temporary = `${path}.tmp-${randomUUID()}`;
  await mkdir(join(getAtelierRuntimeContext().atelierDataDir, "workspaces", workspaceId, "metadata"), { recursive: true });
  await writeFile(temporary, JSON.stringify({ conversations: records }));
  await rename(temporary, path);
}
async function persistConversation(agent: WorkspaceAgentConversationInfo): Promise<void> {
  const records = (await conversationRecords(agent.workspaceId)).filter((item) => item.conversationId !== agent.conversationId);
  records.push({ conversationId: agent.conversationId, label: agent.label, title: agent.title, storage: agent.storage });
  await saveConversationRecords(agent.workspaceId, records);
}

/** Publish a complete snapshot while its source may continue receiving turns. */
export async function publishSessionSnapshot(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await copyFile(source, temporary);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Unnamed conversations stay workspace-local; only named transcripts enter the search share. */
export async function publishWorkspaceAgentHistory(agent: WorkspaceAgentConversationInfo): Promise<void> {
  if (agent.storage === "durable" || agent.title === untitledAgentConversationTitle) return;
  // Historical sessions already reside in the share; they remain readable as-is.
  if (await isLegacySharedSession(agent)) return;
  await publishSessionSnapshot(agent.path, await publishedSessionPath(agent));
}

async function archivePublishedHistory(agent: WorkspaceAgentConversationInfo): Promise<void> {
  await publishWorkspaceAgentHistory(agent);
  if (agent.title === untitledAgentConversationTitle || await isLegacySharedSession(agent)) return;
  const path = await publishedSessionPath(agent);
  await rename(path, path.replace(/\.jsonl$/, ".archived.jsonl"));
}

async function createWorkspaceAgentConversation(workspaceId: string, label: string): Promise<WorkspaceAgentConversationInfo> {
  const conversationId = randomUUID();
  const { workspaceDurableJournalDirectory } = await import("./durable-storage.ts");
  const path = await workspaceDurableJournalDirectory(workspaceId);
  await mkdir(join(getAtelierRuntimeContext().atelierDataDir, "workspaces", workspaceId, "agent-sessions"), { recursive: true });
  const agent: WorkspaceAgentConversationInfo = { workspaceId, conversationId, label, title: untitledAgentConversationTitle, path, storage: "durable" };
  await persistConversation(agent);
  return agent;
}

export async function ensureDefaultWorkspaceAgentConversation(workspaceId: string): Promise<WorkspaceAgentConversationInfo> {
  return await serializeConversationOperation(workspaceId, async () => {
    const current = (await listWorkspaceAgentConversationsUnlocked(workspaceId)).find((agent) => agent.label === "Agent 1");
    return current ?? await createWorkspaceAgentConversation(workspaceId, "Agent 1");
  });
}

async function listWorkspaceAgentConversationsUnlocked(workspaceId: string): Promise<WorkspaceAgentConversationInfo[]> {
  const { workspaceDurableJournalDirectory } = await import("./durable-storage.ts");
  const journal = await workspaceDurableJournalDirectory(workspaceId);
  const local = (await conversationRecords(workspaceId)).map((info) => ({
    workspaceId, conversationId: info.conversationId, label: info.label, title: info.title, storage: info.storage,
    path: info.storage === "durable" ? journal : conversationSessionPath(workspaceId, info.conversationId),
  }));
  // Existing pre-change sessions are still discoverable; new sessions do not use sidecars.
  const directory = sessionShareDir(await workspaceSessionShareKey(workspaceId));
  const sharedEntries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const localIds = new Set(local.map((entry) => entry.conversationId));
  const legacy = await Promise.all(sharedEntries.flatMap((name) => {
    const parsed = parseWorkspaceAgentFilename(name, workspaceId);
    return parsed && !localIds.has(parsed.conversationId) ? [{ name, ...parsed }] : [];
  }).map(async (entry) => ({ workspaceId, conversationId: entry.conversationId, label: entry.label,
    title: (await readFile(join(directory, entry.name.replace(/\.jsonl$/, ".title")), "utf8")).trim(), path: join(directory, entry.name) })));
  return [...local, ...legacy].sort((a, b) => Number(a.label.slice(6)) - Number(b.label.slice(6)));
}

export async function listWorkspaceAgentConversations(workspaceId: string): Promise<WorkspaceAgentConversationInfo[]> {
  return await serializeConversationOperation(workspaceId, async () => await listWorkspaceAgentConversationsUnlocked(workspaceId));
}

export async function createNextWorkspaceAgentConversation(workspaceId: string): Promise<WorkspaceAgentConversationInfo> {
  return await serializeConversationOperation(workspaceId, async () => {
    const used = new Set((await listWorkspaceAgentConversationsUnlocked(workspaceId)).map((agent) => Number(agent.label.slice("Agent ".length))));
    let next = 1;
    while (used.has(next)) next += 1;
    return await createWorkspaceAgentConversation(workspaceId, `Agent ${next}`);
  });
}

/** Archive an Agent conversation's current session and create a fresh session for the same display label. */
export async function replaceWorkspaceAgentSession(agent: WorkspaceAgentConversationInfo): Promise<WorkspaceAgentConversationInfo> {
  if (agent.storage === "durable") throw new Error("Native conversations reset through their execution owner");
  return await serializeConversationOperation(agent.workspaceId, async () => {
    const current = (await listWorkspaceAgentConversationsUnlocked(agent.workspaceId)).find((item) => item.conversationId === agent.conversationId)!;
    await archivePublishedHistory(current);
    await rename(agent.path, agent.path.replace(/\.jsonl$/, ".archived.jsonl"));
    await touch(agent.path);
    return current;
  });
}

export async function setWorkspaceAgentConversationTitle(agent: WorkspaceAgentConversationInfo, title: string): Promise<WorkspaceAgentConversationInfo> {
  if (!title.trim()) throw new Error("Agent conversation title must not be empty");
  return await serializeConversationOperation(agent.workspaceId, async () => {
    const current = (await listWorkspaceAgentConversationsUnlocked(agent.workspaceId)).find((item) => item.conversationId === agent.conversationId)!;
    const updated = { ...current, title };
    if (current.storage === "durable") {
      const { existingDurableController } = await import("./durable-owner.ts");
      await (await existingDurableController(current))?.setTitle(title);
      await persistConversation(updated);
    } else if (await isLegacySharedSession(current)) {
      const path = current.path.replace(/\.jsonl$/, ".title");
      await writeFile(path, `${title}\n`);
    } else {
      await persistConversation(updated);
      await publishWorkspaceAgentHistory(updated);
      if (current.title !== untitledAgentConversationTitle && current.title !== title) {
        await rm(await publishedSessionPath(current), { force: true });
      }
    }
    return updated;
  });
}

export async function archiveWorkspaceAgentConversation(agent: WorkspaceAgentConversationInfo): Promise<void> {
  await serializeConversationOperation(agent.workspaceId, async () => {
    const current = (await listWorkspaceAgentConversationsUnlocked(agent.workspaceId)).find((item) => item.conversationId === agent.conversationId)!;
    if (current.storage === "durable") {
      await saveConversationRecords(current.workspaceId, (await conversationRecords(current.workspaceId)).filter((item) => item.conversationId !== current.conversationId));
      return;
    }
    await archivePublishedHistory(current);
    await rename(current.path, current.path.replace(/\.jsonl$/, ".archived.jsonl"));
    if (await isLegacySharedSession(current)) {
      const titlePath = current.path.replace(/\.jsonl$/, ".title");
      await rename(titlePath, titlePath.replace(/\.title$/, ".archived.title"));
    } else {
      await saveConversationRecords(current.workspaceId, (await conversationRecords(current.workspaceId)).filter((item) => item.conversationId !== current.conversationId));
    }
  });
}
