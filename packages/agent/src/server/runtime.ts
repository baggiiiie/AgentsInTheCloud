import { agentDelegation } from "./delegation.ts";
import { AtelierCoreError } from "@atelier/core";
import { NativeAgentRuntime } from "./native-agent-runtime.ts";
import { durableWorkspaceOwner, suspendDurableWorkspaceOwner, existingDurableController, suspendAllDurableWorkspaceOwners } from "./durable-owner.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { workspaceDurableJournalDirectory } from "./durable-storage.ts";
import { listWorkspaceAgentConversations } from "./session-store.ts";
import type { WorkspaceAgentRuntime, WorkspaceAgentRuntimeOptions } from "./runtime-types.ts";
import type { WorkspaceAgentConversationInfo } from "./session-store.ts";

export type { AgentLivePresentationSubscription, WorkspaceAgentRuntime } from "./runtime-types.ts";
export { subscribeWorkspaceAgentBusy } from "./workspace-agent-busy.ts";

const runtimes = new Map<string, Promise<WorkspaceAgentRuntime>>();
const removedWorkspaceIds = new Set<string>();
const closedConversationKeys = new Set<string>();
const nativeClosedConversationKeys = new Set<string>();
const suspendedWorkspaceIds = new Set<string>();
let stopping = false;
const lifecycle = new Map<string, Promise<void>>();

/** Serialize disposal with mounts: a new mount must never inherit a closing owner. */
function lifecycleCommand(workspaceId: string, run: () => Promise<void>): Promise<void> {
  const previous = lifecycle.get(workspaceId) ?? Promise.resolve();
  const result = previous.then(run, run);
  const drain = result.then(() => {}, () => {});
  lifecycle.set(workspaceId, drain);
  void drain.then(() => { if (lifecycle.get(workspaceId) === drain) lifecycle.delete(workspaceId); });
  return result;
}

function runtimeKey(workspaceId: string, conversationId: string): string {
  return `${workspaceId}\u0000${conversationId}`;
}

export function unloadWorkspaceAgentRuntime(workspaceId: string, conversationId: string): Promise<void> {
  return lifecycleCommand(workspaceId, () => unloadRuntime(workspaceId, conversationId));
}
async function unloadRuntime(workspaceId: string, conversationId: string): Promise<void> {
  const key = runtimeKey(workspaceId, conversationId);
  const runtime = runtimes.get(key);
  if (!runtime) return;
  runtimes.delete(key);
  await (await runtime).dispose();
  if (![...runtimes.keys()].some(key => key.startsWith(`${workspaceId}\u0000`))) await suspendDurableWorkspaceOwner(workspaceId);
}

/** Roll back a failed close after the durable session remained published. */
export function restoreWorkspaceAgentRuntime(workspaceId: string, conversationId: string): void {
  const key = runtimeKey(workspaceId, conversationId);
  if (!nativeClosedConversationKeys.has(key)) closedConversationKeys.delete(key);
}

export function removeWorkspaceAgentRuntimes(workspaceId: string): Promise<void> {
  removedWorkspaceIds.add(workspaceId);
  return lifecycleCommand(workspaceId, () => removeRuntimes(workspaceId));
}
async function removeRuntimes(workspaceId: string): Promise<void> {
  const pending = [...runtimes.entries()].filter(([key]) => key.startsWith(`${workspaceId}\u0000`));
  await Promise.allSettled(pending.map(([, runtime]) => runtime));
  const native = existsSync(join(await workspaceDurableJournalDirectory(workspaceId), "main.jsonl"));
  if (native) await (await durableWorkspaceOwner(workspaceId)).delete();
  await agentDelegation?.removingWorkspace(workspaceId);
  const matching = [...runtimes.entries()].filter(([key]) => key.startsWith(`${workspaceId}\u0000`));
  for (const [key] of matching) runtimes.delete(key);
  const settled = await Promise.allSettled(matching.map(([, runtime]) => runtime));
  await Promise.all(settled.flatMap((result) => result.status === "fulfilled" ? [result.value.dispose()] : []));
  await suspendDurableWorkspaceOwner(workspaceId);
}

export function getWorkspaceAgentRuntime(agent: WorkspaceAgentConversationInfo, options: WorkspaceAgentRuntimeOptions = {}): Promise<WorkspaceAgentRuntime> {
  if (stopping || suspendedWorkspaceIds.has(agent.workspaceId)) throw new Error("Workspace agent execution is suspended");
  if (removedWorkspaceIds.has(agent.workspaceId)) throw new AtelierCoreError("workspace_not_found", `workspace not found: ${agent.workspaceId}`);
  const key = runtimeKey(agent.workspaceId, agent.conversationId);
  if (closedConversationKeys.has(key)) throw new AtelierCoreError("agent_conversation_not_found", `Agent conversation not found: ${agent.conversationId}`);
  const pendingLifecycle = lifecycle.get(agent.workspaceId);
  if (pendingLifecycle) return pendingLifecycle.then(() => getWorkspaceAgentRuntime(agent, options));
  let runtime = runtimes.get(key);
  if (!runtime) {
    runtime = NativeAgentRuntime.create(agent, options).catch((error) => {
      runtimes.delete(key);
      throw error;
    });
    runtimes.set(key, runtime);
  }
  return runtime;
}

/** Explicit user close, distinct from unloading a runtime. */
export function closeWorkspaceAgentConversation(workspaceId: string, conversationId: string): Promise<void> {
  closedConversationKeys.add(runtimeKey(workspaceId, conversationId));
  return lifecycleCommand(workspaceId, () => closeConversation(workspaceId, conversationId));
}
async function closeConversation(workspaceId: string, conversationId: string): Promise<void> {
  const key = runtimeKey(workspaceId, conversationId);
  const pending = runtimes.get(key);
  if (pending) await pending;
  const agent = (await listWorkspaceAgentConversations(workspaceId)).find(item => item.conversationId === conversationId);
  if (agent) {
    nativeClosedConversationKeys.add(key);
    await (await existingDurableController(agent))?.close();
  }
  await unloadRuntime(workspaceId, conversationId);
  await agentDelegation?.closingConversation(workspaceId, conversationId);
}

/** Stop is allowed while parked; it does not need an execution/UI mount. */
export function stopDurableWorkspaceAgentConversation(agent: WorkspaceAgentConversationInfo, options: WorkspaceAgentRuntimeOptions = {}): Promise<void> {
  return lifecycleCommand(agent.workspaceId, async () => {
    await (await existingDurableController(agent, options))?.stop();
  });
}

/** Update live composer controls without replacing drafts or existing model selections. */
export async function refreshConfiguredAgentRuntimes(): Promise<void> {
  await Promise.all([...runtimes.values()].map(async (pending) => {
    await (await pending).refreshModelConfiguration();
  }));
}

/** Skills and templates are workspace-wide, including other mounted conversations. */
export async function refreshWorkspaceCompletionCatalogs(workspaceId: string): Promise<void> {
  const matching = [...runtimes.entries()].filter(([key]) => key.startsWith(`${workspaceId}\u0000`));
  await Promise.all(matching.map(async ([, pending]) => (await pending).refreshCompletionCatalog()));
}

/** Host parking/shutdown suspends execution, unlike permanent close/delete. */
export function suspendWorkspaceAgentRuntimes(workspaceId: string): Promise<void> {
  suspendedWorkspaceIds.add(workspaceId);
  return lifecycleCommand(workspaceId, () => suspendRuntimes(workspaceId));
}
async function suspendRuntimes(workspaceId: string): Promise<void> {
  const matching = [...runtimes.entries()].filter(([key]) => key.startsWith(`${workspaceId}\u0000`));
  for (const [key] of matching) runtimes.delete(key);
  for (const [, runtime] of matching) await (await runtime).dispose();
  await suspendDurableWorkspaceOwner(workspaceId);
}

export function allowWorkspaceAgentResume(workspaceId: string): void {
  suspendedWorkspaceIds.delete(workspaceId);
}
export async function stopWorkspaceAgentRuntimes(): Promise<void> {
  stopping = true;
  const workspaces = new Set([...runtimes.keys()].map(key => key.split("\u0000")[0]!));
  for (const workspaceId of workspaces) await suspendWorkspaceAgentRuntimes(workspaceId);
  await suspendAllDurableWorkspaceOwners();
}
