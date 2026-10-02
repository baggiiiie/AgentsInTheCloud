import type { AtelierEventBus } from "@atelier/core";
import { durableWorkspaceOwner } from "./durable-owner.ts";
import { getWorkspaceAgentRuntime, allowWorkspaceAgentResume } from "./runtime.ts";
import { listWorkspaceAgentConversations } from "./session-store.ts";

/** Legacy transcripts are read-only. Resume committed native tasks, never synthetic input. */
export async function resumeInterruptedAgentSessions(workspaces: readonly { id: string; parked: boolean }[], events: AtelierEventBus): Promise<void> {
  await Promise.all(workspaces.filter(workspace => !workspace.parked).map(async workspace => {
    try {
      allowWorkspaceAgentResume(workspace.id);
      const agents = (await listWorkspaceAgentConversations(workspace.id)).filter(agent => !agent.readOnly);
      if (!agents.length) return;
      await Promise.all(agents.map(agent => getWorkspaceAgentRuntime(agent, { events })));
      await (await durableWorkspaceOwner(workspace.id, { events })).resume();
    } catch (error) { console.error(`Could not resume native Agent workspace ${workspace.id}`, error); }
  }));
}
