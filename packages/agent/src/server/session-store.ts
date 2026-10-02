import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createKeyedOperationQueue, getAgentsInTheCloudRuntimeContext, isJsonObject } from "@agents-in-the-cloud/core";
import type { GitProjectInitInstruction } from "@agents-in-the-cloud/projects";
import { isGitProjectInit } from "@agents-in-the-cloud/projects";
import type { WorkspaceInitInstruction } from "@agents-in-the-cloud/workspace";
import { Type } from "typebox";
import { Value } from "typebox/value";

export interface WorkspaceAgentConversationInfo {
  workspaceId: string;
  conversationId: string;
  label: string;
  title: string;
  path: string;
  storage?: "durable";
  readOnly?: boolean;
}

export const projectlessSessionShareKey = "projectless";
export const sessionShareMountPath = "/agents-in-the-cloud/session-share";
export const untitledAgentConversationTitle = "Untitled";
const serializeConversationOperation = createKeyedOperationQueue();

function workspaceMetadataInitPath(workspaceId: string, dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): string {
  return join(dataDir, "workspaces", workspaceId, "metadata", "init.json");
}

async function workspaceProjectInit(workspaceId: string, dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): Promise<GitProjectInitInstruction | undefined> {
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

export async function workspaceSessionShareKey(workspaceId: string, dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): Promise<string> {
  return sessionShareKeyForInit(await workspaceProjectInit(workspaceId, dataDir));
}

export function sessionShareDir(shareKey: string, dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): string {
  return join(dataDir, "session-shares", sessionShareKeySlug(shareKey));
}

export interface ConversationRecord { conversationId: string; label: string; title: string; storage: "durable" }
const conversationsSchema = Type.Object({ version: Type.Literal(1), conversations: Type.Array(Type.Object({ conversationId: Type.String(), label: Type.String(), title: Type.String(), storage: Type.Literal("durable") })) });
function conversationMetadataPath(workspaceId: string): string {
  return join(getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir, "workspaces", workspaceId, "metadata", "agent-conversations.json");
}
async function conversationRecords(workspaceId: string): Promise<ConversationRecord[]> {
  const content = await readFile(conversationMetadataPath(workspaceId), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  const value: unknown = content ? JSON.parse(content) : undefined;
  if (isJsonObject(value) && value.version !== undefined) {
    Value.Assert(conversationsSchema, value);
    return value.conversations;
  }
  const { convertLegacyConversations } = await import("@agents-in-the-cloud/legacy-converter");
  const records = await convertLegacyConversations({
    workspaceId,
    workspaceDirectory: join(getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir, "workspaces", workspaceId),
    shareDirectory: sessionShareDir(await workspaceSessionShareKey(workspaceId)),
    metadata: content || undefined,
    destination: async () => {
      const { durableWorkspaceOwner } = await import("./runtime.ts");
      return durableWorkspaceOwner(workspaceId);
    },
  });
  if (content !== undefined || records.length) await saveConversationRecords(workspaceId, records);
  return records;
}
async function saveConversationRecords(workspaceId: string, records: ConversationRecord[]): Promise<void> {
  const path = conversationMetadataPath(workspaceId);
  const temporary = `${path}.tmp-${randomUUID()}`;
  await mkdir(join(getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir, "workspaces", workspaceId, "metadata"), { recursive: true });
  await writeFile(temporary, JSON.stringify({ version: 1, conversations: records }));
  await rename(temporary, path);
}
async function persistConversation(agent: WorkspaceAgentConversationInfo): Promise<void> {
  const records = (await conversationRecords(agent.workspaceId)).filter((item) => item.conversationId !== agent.conversationId);
  records.push({ conversationId: agent.conversationId, label: agent.label, title: agent.title, storage: "durable" });
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

async function createWorkspaceAgentConversation(workspaceId: string, label: string): Promise<WorkspaceAgentConversationInfo> {
  const conversationId = randomUUID();
  const { workspaceDurableJournalDirectory } = await import("./durable-storage.ts");
  const path = await workspaceDurableJournalDirectory(workspaceId);
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
  const local: WorkspaceAgentConversationInfo[] = (await conversationRecords(workspaceId)).map(info => ({ ...info, workspaceId, path: journal }));
  // The journal catalog wins after a crash between a metadata commit and tab metadata.
  if (local.length && await Bun.file(join(journal, "main.jsonl")).exists()) {
    const { durableWorkspaceOwner } = await import("./runtime.ts");
    const catalog = await (await durableWorkspaceOwner(workspaceId)).catalog();
    for (const agent of local) {
      const committed = catalog.find(record => record.conversationId === agent.conversationId);
      if (committed) { agent.title = committed.title; agent.readOnly = committed.readOnly; }
    }
  }
  return local.sort((a, b) => Number(a.label.slice(6)) - Number(b.label.slice(6)));
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

export async function setWorkspaceAgentConversationTitle(agent: WorkspaceAgentConversationInfo, title: string): Promise<WorkspaceAgentConversationInfo> {
  if (!title.trim()) throw new Error("Agent conversation title must not be empty");
  return await serializeConversationOperation(agent.workspaceId, async () => {
    const current = (await listWorkspaceAgentConversationsUnlocked(agent.workspaceId)).find((item) => item.conversationId === agent.conversationId)!;
    const updated = { ...current, title };
    const { existingDurableController } = await import("./runtime.ts");
    await (await existingDurableController(current))?.setTitle(title);
    await persistConversation(updated);
    return updated;
  });
}

export async function archiveWorkspaceAgentConversation(agent: WorkspaceAgentConversationInfo): Promise<void> {
  await serializeConversationOperation(agent.workspaceId, async () => {
    const current = (await listWorkspaceAgentConversationsUnlocked(agent.workspaceId)).find((item) => item.conversationId === agent.conversationId)!;
    await saveConversationRecords(current.workspaceId, (await conversationRecords(current.workspaceId)).filter((item) => item.conversationId !== current.conversationId));
  });
}
