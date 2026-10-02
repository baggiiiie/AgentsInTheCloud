import type { WorkspaceClientModule } from "@atelier/shared";
import { createRichResponseController } from "./rich-response-controller.ts";

export const atelierClientModule: WorkspaceClientModule = {
  id: "rich-response",
  install({ application, Controller }) {
    application.register("rich-response", createRichResponseController(Controller));
  },
};
