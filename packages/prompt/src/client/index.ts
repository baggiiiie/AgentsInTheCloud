import { isWorkspacePaneVisible, type WorkspaceClientModule } from "@atelier/shared";
import { createAgentAttachmentsController } from "./attachments-controller.ts";
import { createComposerFocusController } from "./composer-focus-controller.ts";
import { createComposerSendHintController } from "./composer-send-hint-controller.ts";
import { createAgentComposerController } from "./agent-composer-controller.ts";
import { createComposerSelectionAutosubmitController } from "./composer-selection-controller.ts";
export const atelierClientModule: WorkspaceClientModule = {
  id: "prompt",
  install({ application, Controller, hooks }) {
    application.register("composer-focus", createComposerFocusController(Controller));
    application.register("composer-send-hint", createComposerSendHintController(Controller));
    application.register("agent-composer", createAgentComposerController(Controller));
    hooks.registerCommandProvider(() => {
      const composer = [...document.querySelectorAll<HTMLElement>('[data-controller~="agent-composer"]')]
        .find((element) => isWorkspacePaneVisible(element) && element.querySelector(".composer .composer-input"));
      if (!composer) return [];
      return [{
        id: "agent.toggle-composer",
        label: "Toggle Agent composer",
        scope: "agent-conversation",
        binding: "Meta+Alt+KeyO",
        run() {
          const action = composer.classList.contains("agent-composer-open") ? "close" : "open";
          composer.querySelector<HTMLButtonElement>(`[data-action="agent-composer#${action}"]`)!.click();
        },
      }];
    });
    application.register("composer-selection-autosubmit", createComposerSelectionAutosubmitController(Controller));
    application.register("agent-attachments", createAgentAttachmentsController(Controller));
  },
};
