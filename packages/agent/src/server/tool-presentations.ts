import type { AgentRenderContext } from "./render-context.ts";
import type { ToolView } from "./transcript.ts";

export interface AgentToolPresentation {
  summary(tool: ToolView): string | undefined;
  detail(ctx: AgentRenderContext, tool: ToolView): string | undefined;
}

export let agentToolPresentations: ReadonlyMap<string, AgentToolPresentation> | undefined;
export function configureAgentToolPresentations(presentations: ReadonlyMap<string, AgentToolPresentation> | undefined): void {
  agentToolPresentations = presentations;
}
