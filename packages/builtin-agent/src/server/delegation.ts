import type { Models } from "@earendil-works/pi-ai";
import type { Extension, Harness, ConversationView, EntryRecord } from "@earendil-works/pi-durable";
import type { AgentTranscriptSnapshot } from "@agents-in-the-cloud/agent/server/transcript-contributions";
import { AgentsInTheCloudCoreError } from "@agents-in-the-cloud/core";
import { listWorkspaceAgentConversations, type WorkspaceAgentConversationInfo } from "./session-store.ts";

import { configureAgentToolPresentations, type AgentToolPresentation } from "@agents-in-the-cloud/agent/server";
export type { AgentToolPresentation } from "@agents-in-the-cloud/agent/server";

export interface AgentDelegation {
  create(models: Models, harness: () => Harness): { extension: Extension; models: Models };
  transcript(view: ConversationView): AgentTranscriptSnapshot;
  attributed(entry: EntryRecord): "task" | "message" | undefined;
  resolveConversation(workspaceId: string, conversationId: string): Promise<WorkspaceAgentConversationInfo | undefined>;
  toolPresentations?: ReadonlyMap<string, AgentToolPresentation>;
}

/** One optional native integration, installed before workspace owners open.
 * Execution belongs to the workspace Harness; presentation is passive. */
export let agentDelegation: AgentDelegation | undefined;
export function configureAgentDelegation(delegation: AgentDelegation | undefined): void {
  agentDelegation = delegation;
  configureAgentToolPresentations(delegation?.toolPresentations);
}

export async function resolveAgentConversation(workspaceId: string, conversationId: string): Promise<WorkspaceAgentConversationInfo> {
  const root = (await listWorkspaceAgentConversations(workspaceId)).find((agent) => agent.conversationId === conversationId);
  if (root) return root;
  const child = await agentDelegation?.resolveConversation(workspaceId, conversationId);
  if (child) return child;
  throw new AgentsInTheCloudCoreError("agent_conversation_not_found", `Agent conversation not found: ${conversationId}`);
}
