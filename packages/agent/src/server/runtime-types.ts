import type { AtelierEventBus } from "@atelier/core";

export type AgentLivePresentationListener = (streamHtml: string) => void;
export type AgentLivePresentationSubscription = import("@atelier/shared").LiveSubscription;

export interface WorkspaceAgentOptions {
  events?: AtelierEventBus;
}
