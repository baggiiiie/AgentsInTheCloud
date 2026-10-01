import { defineExtension, defineTool, type ConversationId } from "@earendil-works/pi-durable";
import { createReceiptBashExtension, workspaceBashOperations, type BashOperations } from "./durable-bash.ts";
import { durableWorkspaceTool } from "./durable-tools.ts";
import { WorkspaceConversations, type DurableConversationRecord } from "./durable-workspace.ts";
import { createOnboardingCapabilities, onboardingToolDefinitions, registeredOnboardingDependencies, remoteBashToolDefinition, type OnboardingToolDependencies } from "./onboarding-tools.ts";

function atelierConversation(records: readonly DurableConversationRecord[], id: ConversationId): string {
  const record = records.find((record) => record.durableId === id);
  if (!record) throw new Error(`No Atelier conversation registered for Durable conversation ${id}`);
  return record.conversationId;
}

/** One registry serves every conversation; authorization uses the calling conversation's committed Atelier identity. */
export function createDurableOnboardingExtension(
  workspaceId: string,
  deps: OnboardingToolDependencies,
  operations: (workspaceId: string) => BashOperations = workspaceBashOperations,
) {
  const remote = createReceiptBashExtension({
    name: "atelier.remote-bash", taskName: "atelier.remote-bash-operation", tool: remoteBashToolDefinition,
    async prepare(args, tx, id) {
      const catalog = await tx.doc(WorkspaceConversations);
      const capabilities = createOnboardingCapabilities(workspaceId, atelierConversation(catalog.conversations, id), deps);
      await capabilities.requireOwnedWorkspace(args.workspace_id, "execute bash in");
      // This admission grants authority to observe/stop this exact operation after
      // restart, without reauthorizing an already-running command or changing target.
      return { command: args.command, timeout: args.timeout, target: { workspaceId: args.workspace_id } };
    },
    workspaceId: (input) => input.workspaceId,
    operations: (input) => operations(input.workspaceId),
  });
  function capability(key: keyof typeof onboardingToolDefinitions, replay: "safe" | "unsafe" = "unsafe") {
    return defineTool({
      ...onboardingToolDefinitions[key], replay,
      async execute(args, api, context) {
        const catalog = (await api.snapshot(WorkspaceConversations, context))!;
        const capabilities = createOnboardingCapabilities(workspaceId, atelierConversation(catalog.conversations, api.conversationId), deps);
        return durableWorkspaceTool(capabilities[key], replay).execute(args, api, context);
      },
    });
  }
  return defineExtension({
    name: "atelier.onboarding",
    tools: [
      capability("readProjectSettings", "safe"),
      capability("writeProjectSettings"),
      capability("requestSecretValue"),
      ...remote.tools!,
      capability("deleteWorkspace"),
      capability("createWorkspace"),
    ],
    tasks: remote.tasks,
  });
}

export function createRegisteredDurableOnboardingExtensions(workspaceId: string) {
  const deps = registeredOnboardingDependencies(workspaceId);
  return deps ? [createDurableOnboardingExtension(workspaceId, deps)] : [];
}
