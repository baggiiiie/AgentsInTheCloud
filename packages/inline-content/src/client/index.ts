import type { WorkspaceClientModule } from "@atelier/shared";
import { createInlineContentController } from "./inline-content-controller.ts";

export const atelierClientModule: WorkspaceClientModule = {
  id: "inline-content",
  install({ application, Controller }) {
    application.register("inline-content", createInlineContentController(Controller));
  },
};
