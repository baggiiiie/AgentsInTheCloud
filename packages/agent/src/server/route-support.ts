import { type AtelierEventBus } from "@atelier/core";
import type { maybeNameAgentFromPrompt } from "./agent-title-suggestion.ts";
import { resolveAgentConversation } from "./delegation.ts";
import { getWorkspaceAgentRuntime } from "./runtime.ts";
import { type WorkspaceAgentConversationInfo } from "./session-store.ts";

export interface AgentRouteOptions {
  renderPage?: (body: string) => Response;
  events?: AtelierEventBus;
  getRuntime?: typeof getWorkspaceAgentRuntime;
  knownRequest?: typeof import("./durable-owner.ts").knownWorkspaceAgentRequest;
  suggestTitleFromPrompt?: typeof maybeNameAgentFromPrompt;
}

export type AgentRouteHandler = (request: Request, url: URL, options: AgentRouteOptions) => Promise<Response | undefined>;

export function matchRoute(url: URL, pattern: RegExp): string[] | undefined {
  const result = url.pathname.match(pattern);
  return result ? result.slice(1).map(decodeURIComponent) : undefined;
}

export async function invalidateAgentView(options: AgentRouteOptions, workspaceId: string, conversationId: string): Promise<void> {
  await options.events?.emit("workspace_agent_view_invalidated", { workspaceId, conversationId });
}

export async function resolveAgentRuntime(agent: WorkspaceAgentConversationInfo, options: AgentRouteOptions): ReturnType<typeof getWorkspaceAgentRuntime> {
  return await (options.getRuntime ?? getWorkspaceAgentRuntime)(agent, { events: options.events });
}

export async function requireAgentRuntime(workspaceId: string, conversationId: string, options: AgentRouteOptions): ReturnType<typeof getWorkspaceAgentRuntime> {
  return await resolveAgentRuntime(await resolveAgentConversation(workspaceId, conversationId, options.events), options);
}
