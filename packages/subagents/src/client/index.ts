import type { WorkspaceClientModule } from "@atelier/shared";
import { createSubagentsController } from "./subagents-controller.ts";
import { createCommunicationController } from "./communication-controller.ts";
export const atelierClientModule: WorkspaceClientModule = {
  id: "subagents",
  install({ application, Controller }) {
    application.register("subagents", createSubagentsController(Controller));
    application.register("agent-communication", createCommunicationController(Controller));
  },
};
