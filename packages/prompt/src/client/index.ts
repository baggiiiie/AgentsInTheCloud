import type { WorkspaceClientModule } from "@atelier/shared";
import { createAgentAttachmentsController } from "./attachments-controller.ts";
import { createComposerFocusController } from "./composer-focus-controller.ts";
import { createComposerSendHintController } from "./composer-send-hint-controller.ts";
import { createAgentComposerController } from "./agent-composer-controller.ts";
import { createComposerSelectionAutosubmitController } from "./composer-selection-controller.ts";
export const atelierClientModule: WorkspaceClientModule = {
  id: "prompt",
  install({ application, Controller }) {
    application.register("composer-focus", createComposerFocusController(Controller));
    application.register("composer-send-hint", createComposerSendHintController(Controller));
    application.register("agent-composer", createAgentComposerController(Controller));
    application.register("composer-selection-autosubmit", createComposerSelectionAutosubmitController(Controller));
    application.register("agent-attachments", createAgentAttachmentsController(Controller));
  },
};
