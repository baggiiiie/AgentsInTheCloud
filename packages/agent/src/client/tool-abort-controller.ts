import { composerSubmitKey, type WorkspaceClientControllerConstructor } from "@agents-in-the-cloud/shared";

export function createAgentToolAbortController(Controller: WorkspaceClientControllerConstructor) {
  return class AgentToolAbortController extends Controller {
    declare readonly element: HTMLFormElement;

    keydown(event: KeyboardEvent): void {
      if (event.isComposing || !composerSubmitKey(event) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      this.element.requestSubmit();
    }
  };
}
