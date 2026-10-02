import { existsSync } from "node:fs";
import { join } from "node:path";
import { workspaceDurableJournalDirectory } from "./durable-storage.ts";
import type { WorkspaceAgentConversationInfo } from "./session-store.ts";
import { openDurableAgentRuntime, type DurableAgentRuntime } from "./durable-runtime.ts";
import type { WorkspaceAgentRuntimeOptions } from "./runtime-types.ts";

// The journal has exactly one writer, shared by every mounted tab in a workspace.
let ownerEvents: WorkspaceAgentRuntimeOptions["events"];
export function configureDurableOwnerEvents(events: NonNullable<WorkspaceAgentRuntimeOptions["events"]>) { ownerEvents = events; }

const owners = new Map<string, Promise<DurableAgentRuntime>>();
const suspensions = new Map<string, Promise<void>>();
export async function durableWorkspaceOwner(workspaceId: string, options: WorkspaceAgentRuntimeOptions = {}): Promise<DurableAgentRuntime> {
  return retainedDurableWorkspaceOwner(await workspaceDurableJournalDirectory(workspaceId), workspaceId, options);
}
const ownerWorkspaces = new Map<string, string>();
/** The directory is resolved by the scoped history service, never accepted from HTTP. */
export function retainedDurableWorkspaceOwner(directory: string, workspaceId: string, options: WorkspaceAgentRuntimeOptions = {}, load?: Parameters<typeof openDurableAgentRuntime>[3]): Promise<DurableAgentRuntime> {
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
export function suspendDurableWorkspaceOwner(workspaceId: string): Promise<void> {
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
export async function existingDurableController(agent: WorkspaceAgentConversationInfo, options: WorkspaceAgentRuntimeOptions = {}) {
  if (!existsSync(join(await workspaceDurableJournalDirectory(agent.workspaceId), "main.jsonl"))) return undefined;
  const owner = await durableWorkspaceOwner(agent.workspaceId, options);
  if (!(await owner.catalog()).some(record => record.conversationId === agent.conversationId)) return undefined;
  return owner.conversation(agent);
}
export async function knownWorkspaceAgentRequest(agent: WorkspaceAgentConversationInfo, requestId: string, options: WorkspaceAgentRuntimeOptions = {}) {
  return (await existingDurableController(agent, options))?.knownRequest(requestId) ?? false;
}
