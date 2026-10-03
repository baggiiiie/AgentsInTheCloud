import type { AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";

export type AgentLivePresentationListener = (streamHtml: string) => void;
export type AgentLivePresentationSubscription = import("@agents-in-the-cloud/shared").LiveSubscription;

export interface WorkspaceAgentOptions {
  events?: AgentsInTheCloudEventBus;
}
