import { type AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import type { maybeNameAgentFromPrompt } from "./agent-title-suggestion.ts";
import { resolveAgentConversation } from "./delegation.ts";
import { getWorkspaceAgentPresentation, getWorkspaceAgentController } from "./runtime.ts";
import { type WorkspaceAgentConversationInfo } from "./session-store.ts";

export interface AgentRouteOptions {
  renderPage?: (body: string) => Response;
  events?: AgentsInTheCloudEventBus;
  getController?: typeof getWorkspaceAgentController;
  getPresentation?: typeof getWorkspaceAgentPresentation;
  knownRequest?: typeof import("./runtime.ts").knownWorkspaceAgentRequest;
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

export async function resolveAgentPresentation(agent: WorkspaceAgentConversationInfo, options: AgentRouteOptions): ReturnType<typeof getWorkspaceAgentPresentation> {
  return await (options.getPresentation ?? getWorkspaceAgentPresentation)(agent, { events: options.events });
}

export async function requireAgentPresentation(workspaceId: string, conversationId: string, options: AgentRouteOptions): ReturnType<typeof getWorkspaceAgentPresentation> {
  return await resolveAgentPresentation(await resolveAgentConversation(workspaceId, conversationId, options.events), options);
}

export async function resolveAgentController(agent: WorkspaceAgentConversationInfo, options: AgentRouteOptions): ReturnType<typeof getWorkspaceAgentController> {
  return (options.getController ?? getWorkspaceAgentController)(agent, { events: options.events });
}

export async function requireAgentController(workspaceId: string, conversationId: string, options: AgentRouteOptions): ReturnType<typeof getWorkspaceAgentController> {
  return resolveAgentController(await resolveAgentConversation(workspaceId, conversationId, options.events), options);
}
