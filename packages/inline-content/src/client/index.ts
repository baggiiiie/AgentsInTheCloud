import type { WorkspaceClientModule } from "@agents-in-the-cloud/shared";
import { createInlineContentController } from "./inline-content-controller.ts";

export const agentsInTheCloudClientModule: WorkspaceClientModule = {
  id: "inline-content",
  install({ application, Controller }) {
    application.register("inline-content", createInlineContentController(Controller));
  },
};
