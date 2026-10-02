import type { Models } from "@earendil-works/pi-ai";
import type { Extension, Harness, ConversationView, EntryRecord } from "@earendil-works/pi-durable";
import type { AgentTranscriptSnapshot } from "./transcript-contributions.ts";
import { AgentsInTheCloudCoreError, type AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import type { AgentRenderContext } from "./render-context.ts";
import { listWorkspaceAgentConversations, type WorkspaceAgentConversationInfo } from "./session-store.ts";
import type { ToolView } from "./transcript.ts";

export interface AgentToolPresentation {
  summary(tool: ToolView): string | undefined;
  detail(ctx: AgentRenderContext, tool: ToolView): string | undefined;
}

export interface AgentDelegation {
  create(models: Models, harness: () => Harness): { extension: Extension; models: Models };
  transcript(view: ConversationView): AgentTranscriptSnapshot;
  attributed(entry: EntryRecord): "task" | "message" | undefined;
  resolveConversation(workspaceId: string, conversationId: string, events?: AgentsInTheCloudEventBus): Promise<WorkspaceAgentConversationInfo | undefined>;
  toolPresentations?: ReadonlyMap<string, AgentToolPresentation>;
}

/** One optional native integration, installed before workspace owners open.
 * Execution belongs to the workspace Harness; presentation is passive. */
export let agentDelegation: AgentDelegation | undefined;
export function configureAgentDelegation(delegation: AgentDelegation | undefined): void {
  agentDelegation = delegation;
}

export async function resolveAgentConversation(workspaceId: string, conversationId: string, events?: AgentsInTheCloudEventBus): Promise<WorkspaceAgentConversationInfo> {
  const root = (await listWorkspaceAgentConversations(workspaceId)).find((agent) => agent.conversationId === conversationId);
  if (root) return root;
  const child = await agentDelegation?.resolveConversation(workspaceId, conversationId, events);
  if (child) return child;
  throw new AgentsInTheCloudCoreError("agent_conversation_not_found", `Agent conversation not found: ${conversationId}`);
}
