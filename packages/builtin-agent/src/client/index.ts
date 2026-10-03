import type { WorkspaceClientModule } from "@agents-in-the-cloud/shared";
import { createAgentNotificationsController } from "./notifications-controller.ts";
import { createAgentPaneController, registerAgentPaneVisibilityHooks } from "./agent-pane.ts";
import { createAgentTurnController } from "./turn-controller.ts";
import { createAgentTermController } from "./terminal-controller.ts";

export const builtinAgentClientModule: WorkspaceClientModule = {
  id: "builtin-agent",
  install({ application, Controller, hooks }) {
    application.register("agent-notifications", createAgentNotificationsController(Controller));
    application.register("agent-pane", createAgentPaneController(Controller));
    application.register("agent-turn", createAgentTurnController(Controller));
    application.register("agent-term", createAgentTermController(Controller));
    registerAgentPaneVisibilityHooks(application, hooks);
  },
};
export { builtinAgentClientModule as agentsInTheCloudClientModule };
export { agentConnectionShouldRun } from "./agent-pane.ts";
export { forwardAgentTerminalWheel, terminalOutputHasPrintableText } from "./terminal-controller.ts";
