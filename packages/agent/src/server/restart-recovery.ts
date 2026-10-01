import type { AtelierEventBus } from "@atelier/core";
import { type SessionEntry } from "@earendil-works/pi-coding-agent";
import { durableWorkspaceOwner } from "./durable-owner.ts";
import { getWorkspaceAgentRuntime, allowWorkspaceAgentResume } from "./runtime.ts";
import { listWorkspaceAgentConversations } from "./session-store.ts";
import { isFinalAssistantStopReason } from "./transcript.ts";

export const atelierRestartPrompt = "The atelier host had to restart. Your execution environment did not restart. You may continue if you had any unfinished business";

/** A non-empty active branch needs recovery unless its last message is a terminal assistant response. */
export function agentSessionNeedsRestartRecovery(entries: readonly SessionEntry[]): boolean {
  const latestMessage = entries.findLast((entry) => entry.type === "message");
  if (!latestMessage || latestMessage.type !== "message") return false;
  const message = latestMessage.message;
  return message.role !== "assistant" || !isFinalAssistantStopReason(message.stopReason ?? "stop");
}

/** Legacy transcripts are read-only. Resume committed native tasks, never synthetic input. */
export async function resumeInterruptedAgentSessions(workspaces: readonly { id: string; parked: boolean }[], events: AtelierEventBus): Promise<void> {
  await Promise.all(workspaces.filter(workspace => !workspace.parked).map(async workspace => {
    try {
      allowWorkspaceAgentResume(workspace.id);
      const agents = (await listWorkspaceAgentConversations(workspace.id)).filter(agent => agent.storage === "durable");
      if (!agents.length) return;
      await Promise.all(agents.map(agent => getWorkspaceAgentRuntime(agent, { events })));
      await (await durableWorkspaceOwner(workspace.id, { events })).resume();
    } catch (error) { console.error(`Could not resume native Agent workspace ${workspace.id}`, error); }
  }));
}
