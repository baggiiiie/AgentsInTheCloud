import { AgentsInTheCloudCoreError } from "@agents-in-the-cloud/core";
import { ConversationPresentation } from "./conversation-presentation.ts";
import { openDurableAgentRuntime, type DurableAgentRuntime } from "./durable-runtime.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { workspaceDurableJournalDirectory } from "./durable-storage.ts";
import { listWorkspaceAgentConversations } from "./session-store.ts";
import type { WorkspaceAgentOptions } from "./runtime-types.ts";
import type { WorkspaceAgentConversationInfo } from "./session-store.ts";

export type { AgentLivePresentationSubscription } from "./runtime-types.ts";
export { subscribeWorkspaceAgentBusy } from "./workspace-agent-busy.ts";

const presentations = new Map<string, Promise<ConversationPresentation>>();
// First attachment can prepare a root before it exists in the catalog. Lifecycle
// fences must join that acquisition even when no presentation was ever mounted.
const controllerAcquisitions = new Map<string, Promise<Awaited<ReturnType<DurableAgentRuntime["conversation"]>>>>();
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

export function unloadWorkspaceAgentPresentation(workspaceId: string, conversationId: string): Promise<void> {
  return lifecycleCommand(workspaceId, () => unloadRuntime(workspaceId, conversationId));
}
async function unloadRuntime(workspaceId: string, conversationId: string): Promise<void> {
  const key = runtimeKey(workspaceId, conversationId);
  const runtime = presentations.get(key);
  if (!runtime) return;
  presentations.delete(key);
  await (await runtime).dispose();
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
  await drainControllerAcquisitions(workspaceId);
  const pending = [...presentations.entries()].filter(([key]) => key.startsWith(`${workspaceId}\u0000`));
  await Promise.allSettled(pending.map(([, runtime]) => runtime));
  const native = existsSync(join(await workspaceDurableJournalDirectory(workspaceId), "main.jsonl"));
  if (native) await (await durableWorkspaceOwner(workspaceId)).delete();
  const matching = [...presentations.entries()].filter(([key]) => key.startsWith(`${workspaceId}\u0000`));
  for (const [key] of matching) presentations.delete(key);
  const settled = await Promise.allSettled(matching.map(([, runtime]) => runtime));
  await Promise.all(settled.flatMap((result) => result.status === "fulfilled" ? [result.value.dispose()] : []));
  await suspendDurableWorkspaceOwner(workspaceId);
}

export function getWorkspaceAgentPresentation(agent: WorkspaceAgentConversationInfo, options: WorkspaceAgentOptions = {}): Promise<ConversationPresentation> {
  assertWorkspaceAgentAvailable(agent);
  const key = runtimeKey(agent.workspaceId, agent.conversationId);
  const pendingLifecycle = lifecycle.get(agent.workspaceId);
  if (pendingLifecycle) return pendingLifecycle.then(() => getWorkspaceAgentPresentation(agent, options));
  let runtime = presentations.get(key);
  if (!runtime) {
    runtime = (async () => ConversationPresentation.create(agent, await (await durableWorkspaceOwner(agent.workspaceId, options)).conversation(agent)))().catch((error) => {
      presentations.delete(key);
      throw error;
    });
    presentations.set(key, runtime);
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
  const pending = presentations.get(key);
  if (pending) await pending;
  await Promise.allSettled([controllerAcquisitions.get(key)]);
  const agent = (await listWorkspaceAgentConversations(workspaceId)).find(item => item.conversationId === conversationId);
  if (agent) {
    nativeClosedConversationKeys.add(key);
    await (await existingDurableController(agent))?.close();
  }
  await unloadRuntime(workspaceId, conversationId);
}

/** Stop is allowed while parked; it does not need an execution/UI mount. */
export function stopDurableWorkspaceAgentConversation(agent: WorkspaceAgentConversationInfo, options: WorkspaceAgentOptions = {}): Promise<void> {
  return lifecycleCommand(agent.workspaceId, async () => {
    await Promise.allSettled([controllerAcquisitions.get(runtimeKey(agent.workspaceId, agent.conversationId))]);
    await (await existingDurableController(agent, options))?.stop();
  });
}

/** Update live composer controls without replacing drafts or existing model selections. */
export async function refreshConfiguredAgentRuntimes(): Promise<void> {
  await Promise.all([...presentations.values()].map(async (pending) => {
    await (await pending).refreshModelConfiguration();
  }));
}

/** Skills and templates are workspace-wide, including other mounted conversations. */
export async function refreshWorkspaceCompletionCatalogs(workspaceId: string): Promise<void> {
  const matching = [...presentations.entries()].filter(([key]) => key.startsWith(`${workspaceId}\u0000`));
  await Promise.all(matching.map(async ([, pending]) => (await pending).refreshCompletionCatalog()));
}

/** Host parking/shutdown suspends execution, unlike permanent close/delete. */
export function suspendWorkspaceAgentRuntimes(workspaceId: string): Promise<void> {
  suspendedWorkspaceIds.add(workspaceId);
  return lifecycleCommand(workspaceId, () => suspendRuntimes(workspaceId));
}
async function suspendRuntimes(workspaceId: string): Promise<void> {
  await drainControllerAcquisitions(workspaceId);
  const matching = [...presentations.entries()].filter(([key]) => key.startsWith(`${workspaceId}\u0000`));
  for (const [key] of matching) presentations.delete(key);
  for (const [, runtime] of matching) await (await runtime).dispose();
  await suspendDurableWorkspaceOwner(workspaceId);
}

export function allowWorkspaceAgentResume(workspaceId: string): void {
  suspendedWorkspaceIds.delete(workspaceId);
}
export async function stopWorkspaceAgentRuntimes(): Promise<void> {
  stopping = true;
  const workspaces = new Set([...presentations.keys(), ...controllerAcquisitions.keys(), ...ownerWorkspaces.values()].map(key => key.split("\u0000")[0]!));
  for (const workspaceId of workspaces) await suspendWorkspaceAgentRuntimes(workspaceId);
  await suspendAllDurableWorkspaceOwners();
}

function assertWorkspaceAgentAvailable(agent: WorkspaceAgentConversationInfo): void {
  if (stopping || suspendedWorkspaceIds.has(agent.workspaceId)) throw new Error("Workspace agent execution is suspended");
  if (removedWorkspaceIds.has(agent.workspaceId)) throw new AgentsInTheCloudCoreError("workspace_not_found", `workspace not found: ${agent.workspaceId}`);
  if (closedConversationKeys.has(runtimeKey(agent.workspaceId, agent.conversationId))) throw new AgentsInTheCloudCoreError("agent_conversation_not_found", `Agent conversation not found: ${agent.conversationId}`);
}

/** Execution does not require a mounted transcript or composer. */
export function getWorkspaceAgentController(agent: WorkspaceAgentConversationInfo, options: WorkspaceAgentOptions = {}): Promise<Awaited<ReturnType<DurableAgentRuntime["conversation"]>>> {
  assertWorkspaceAgentAvailable(agent);
  const pending = lifecycle.get(agent.workspaceId);
  if (pending) return pending.then(() => getWorkspaceAgentController(agent, options));
  const key = runtimeKey(agent.workspaceId, agent.conversationId);
  let acquisition = controllerAcquisitions.get(key);
  if (!acquisition) {
    acquisition = (async () => {
      const owner = await durableWorkspaceOwner(agent.workspaceId, options);
      assertWorkspaceAgentAvailable(agent);
      return owner.conversation(agent);
    })().finally(() => { controllerAcquisitions.delete(key); });
    controllerAcquisitions.set(key, acquisition);
  }
  return acquisition;
}

async function drainControllerAcquisitions(workspaceId: string): Promise<void> {
  await Promise.allSettled([...controllerAcquisitions].filter(([key]) => key.startsWith(`${workspaceId}\u0000`)).map(([, pending]) => pending));
}

// The journal has exactly one writer, shared by every mounted tab in a workspace.
let ownerEvents: WorkspaceAgentOptions["events"];
export function configureDurableOwnerEvents(events: NonNullable<WorkspaceAgentOptions["events"]>) { ownerEvents = events; }

const owners = new Map<string, Promise<DurableAgentRuntime>>();
const suspensions = new Map<string, Promise<void>>();
export async function durableWorkspaceOwner(workspaceId: string, options: WorkspaceAgentOptions = {}): Promise<DurableAgentRuntime> {
  return retainedDurableWorkspaceOwner(await workspaceDurableJournalDirectory(workspaceId), workspaceId, options);
}
const ownerWorkspaces = new Map<string, string>();
/** The directory is resolved by the scoped history service, never accepted from HTTP. */
export function retainedDurableWorkspaceOwner(directory: string, workspaceId: string, options: WorkspaceAgentOptions = {}, load?: Parameters<typeof openDurableAgentRuntime>[3]): Promise<DurableAgentRuntime> {
  const suspension = suspensions.get(workspaceId);
  if (suspension) return suspension.then(() => retainedDurableWorkspaceOwner(directory, workspaceId, options, load));
  let owner = owners.get(directory);
  if (!owner) {
    owner = openDurableAgentRuntime(directory, workspaceId, { events: options.events ?? ownerEvents }, load).catch(error => {
      owners.delete(directory);
      ownerWorkspaces.delete(directory);
      throw error;
    });
    owners.set(directory, owner);
    ownerWorkspaces.set(directory, workspaceId);
  }
  return owner;
}
function suspendDurableWorkspaceOwner(workspaceId: string): Promise<void> {
  const pending = suspensions.get(workspaceId);
  if (pending) return pending;
  const selected = [...owners].filter(([directory]) => ownerWorkspaces.get(directory) === workspaceId);
  if (!selected.length) return Promise.resolve();
  const closing = (async () => {
    await Promise.all(selected.map(async ([directory, owner]) => {
      await (await owner).suspend();
      owners.delete(directory);
      ownerWorkspaces.delete(directory);
    }));
  })().finally(() => { suspensions.delete(workspaceId); });
  suspensions.set(workspaceId, closing);
  return closing;
}
export async function suspendAllDurableWorkspaceOwners() {
  await Promise.all([...new Set(ownerWorkspaces.values())].map(suspendDurableWorkspaceOwner));
}

/** Lookup must not create a new root or prepare prompts just to reject bad input. */
export async function existingDurableController(agent: WorkspaceAgentConversationInfo, options: WorkspaceAgentOptions = {}) {
  if (!existsSync(join(await workspaceDurableJournalDirectory(agent.workspaceId), "main.jsonl"))) return undefined;
  const owner = await durableWorkspaceOwner(agent.workspaceId, options);
  if (!(await owner.catalog()).some(record => record.conversationId === agent.conversationId)) return undefined;
  return owner.conversation(agent);
}
export async function knownWorkspaceAgentRequest(agent: WorkspaceAgentConversationInfo, requestId: string, options: WorkspaceAgentOptions = {}) {
  return (await existingDurableController(agent, options))?.knownRequest(requestId) ?? false;
}
