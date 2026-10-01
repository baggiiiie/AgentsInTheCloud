import { existsSync } from "node:fs";
import { join } from "node:path";
import { workspaceDurableJournalDirectory } from "./durable-storage.ts";
import type { WorkspaceAgentConversationInfo } from "./session-store.ts";
import { openRetainedDurableAgentRuntime, type DurableAgentRuntime } from "./durable-runtime.ts";
import type { WorkspaceAgentRuntimeOptions } from "./runtime-types.ts";

// The journal has exactly one writer, shared by every mounted tab in a workspace.
let ownerEvents: WorkspaceAgentRuntimeOptions["events"];
export function configureDurableOwnerEvents(events: NonNullable<WorkspaceAgentRuntimeOptions["events"]>) { ownerEvents = events; }

const owners = new Map<string, Promise<DurableAgentRuntime>>();
const suspensions = new Map<string, Promise<void>>();
export function durableWorkspaceOwner(workspaceId: string, options: WorkspaceAgentRuntimeOptions = {}): Promise<DurableAgentRuntime> {
  const suspension = suspensions.get(workspaceId);
  if (suspension) return suspension.then(() => durableWorkspaceOwner(workspaceId, options));
  let owner = owners.get(workspaceId);
  if (!owner) {
    owner = openRetainedDurableAgentRuntime(workspaceId, { events: options.events ?? ownerEvents }).catch(error => {
      owners.delete(workspaceId);
      throw error;
    });
    owners.set(workspaceId, owner);
  }
  return owner;
}
export function suspendDurableWorkspaceOwner(workspaceId: string): Promise<void> {
  const pending = suspensions.get(workspaceId);
  if (pending) return pending;
  const owner = owners.get(workspaceId);
  if (!owner) return Promise.resolve();
  const closing = (async () => {
    await (await owner).suspend();
    owners.delete(workspaceId);
  })().finally(() => { suspensions.delete(workspaceId); });
  suspensions.set(workspaceId, closing);
  return closing;
}
export async function suspendAllDurableWorkspaceOwners() {
  await Promise.all([...owners.keys()].map(suspendDurableWorkspaceOwner));
}

/** Lookup must not create a new root or prepare prompts just to reject bad input. */
export async function existingDurableController(agent: WorkspaceAgentConversationInfo, options: WorkspaceAgentRuntimeOptions = {}) {
  if (agent.storage !== "durable" || !existsSync(join(await workspaceDurableJournalDirectory(agent.workspaceId), "main.jsonl"))) return undefined;
  const owner = await durableWorkspaceOwner(agent.workspaceId, options);
  if (!(await owner.catalog()).some(record => record.conversationId === agent.conversationId)) return undefined;
  return owner.conversation(agent);
}
export async function knownWorkspaceAgentRequest(agent: WorkspaceAgentConversationInfo, requestId: string, options: WorkspaceAgentRuntimeOptions = {}) {
  return (await existingDurableController(agent, options))?.knownRequest(requestId) ?? false;
}
