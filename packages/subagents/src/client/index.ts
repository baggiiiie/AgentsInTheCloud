import type { WorkspaceClientModule } from "@agents-in-the-cloud/shared";
import { createCommunicationController } from "./communication-controller.ts";
import { createSubagentsController } from "./subagents-controller.ts";

export const agentsInTheCloudClientModule: WorkspaceClientModule = {
  id: "subagents",
  install({ application, Controller }) {
    application.register("agent-communication", createCommunicationController(Controller));
    application.register("subagents", createSubagentsController(Controller));
  },
};
