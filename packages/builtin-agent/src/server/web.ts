import { AgentsInTheCloudCoreError, createKeyedOperationQueue, type AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import { builtinAgentIconHtml } from "@agents-in-the-cloud/design-system/icons";
import { launchComposerCommand, type WorkspaceAgentTabProvider, type WorkspaceCommandContribution, type WorkspaceModule } from "@agents-in-the-cloud/shared";
import { registerAgentEvents } from "./agent-events.ts";
import { resolveAgentConversation } from "./delegation.ts";
import { removeWorkspaceInitialPromptDrafts } from "./initial-prompt-draft.ts";
import { nativeAgentLaunch } from "./launch.ts";
import { resolveNewWorkspaceAgentModel } from "@agents-in-the-cloud/agent/server/model-state";
import { renderAgentPane } from "./render-composer.ts";
import { agentConversationKey } from "@agents-in-the-cloud/agent/server/render-context";
import { handleAgentRequest } from "./routes.ts";
import { refreshWorkspaceCompletionCatalogs, closeWorkspaceAgentConversation, getWorkspaceAgentController, getWorkspaceAgentPresentation, restoreWorkspaceAgentRuntime } from "./runtime.ts";
import { archiveWorkspaceAgentConversation, createNextWorkspaceAgentConversation, listWorkspaceAgentConversations, untitledAgentConversationTitle, type WorkspaceAgentConversationInfo } from "./session-store.ts";

let agentEvents: AgentsInTheCloudEventBus | undefined;

export function createWorkspaceAgentTabProvider(dependencies: {
  list(workspaceId: string): Promise<readonly WorkspaceAgentConversationInfo[]>;
  render(conversation: WorkspaceAgentConversationInfo): Promise<string>;
  dispose(workspaceId: string, conversationId: string): Promise<void>;
  restore(workspaceId: string, conversationId: string): void;
  archive(conversation: WorkspaceAgentConversationInfo): Promise<void>;
}): WorkspaceAgentTabProvider {
  const serializedClose = createKeyedOperationQueue();

  return {
    async list({ workspaceId }) {
      return (await dependencies.list(workspaceId)).map(({ conversationId, title }) => ({ id: conversationId, title, untitled: title === untitledAgentConversationTitle }));
    },

    async render({ workspaceId, conversationId }) {
      const conversation = (await dependencies.list(workspaceId)).find((candidate) => candidate.conversationId === conversationId);
      if (!conversation) throw new AgentsInTheCloudCoreError("agent_conversation_not_found", `Agent conversation not found: ${conversationId}`);
      return await dependencies.render(conversation);
    },

    async close({ workspaceId, conversationId }) {
      await serializedClose(workspaceId, async () => {
        const conversations = await dependencies.list(workspaceId);
        const conversation = conversations.find((candidate) => candidate.conversationId === conversationId);
        if (!conversation) throw new AgentsInTheCloudCoreError("agent_conversation_not_found", `Agent conversation not found: ${conversationId}`);
        try {
          await dependencies.dispose(workspaceId, conversationId);
          await dependencies.archive(conversation);
        } catch (error) {
          dependencies.restore(workspaceId, conversationId);
          throw error;
        }
      });
    },
  };
}

export const workspaceAgentTabProvider = createWorkspaceAgentTabProvider({
  list: listWorkspaceAgentConversations,
  async render(conversation) {
    const runtime = await getWorkspaceAgentPresentation(conversation, { events: agentEvents });
    const [state, completionCatalog] = await Promise.all([
      runtime.paneState(),
      runtime.refreshCompletionCatalog(),
    ]);
    return await renderAgentPane(
      { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId },
      conversation,
      state,
      completionCatalog,
    );
  },
  dispose: closeWorkspaceAgentConversation,
  restore: restoreWorkspaceAgentRuntime,
  archive: archiveWorkspaceAgentConversation,
});

const launchComposerCommandContribution: WorkspaceCommandContribution = {
  id: launchComposerCommand.id,
  label: launchComposerCommand.label,
  description: launchComposerCommand.description,
  scope: "global",
  surfaces: { shortcut: { defaultBinding: launchComposerCommand.binding } },
};

async function applyNewAgentSettings(agent: WorkspaceAgentConversationInfo, source: WorkspaceAgentConversationInfo | undefined, events?: AgentsInTheCloudEventBus): Promise<void> {
  const runtimeOptions = { events };
  const sourceController = source ? await getWorkspaceAgentController(source, runtimeOptions) : undefined;
  const sourceSettings = await sourceController?.settings();
  const model = sourceSettings?.model ?? await resolveNewWorkspaceAgentModel().then(model => model && { provider: model.provider, modelId: model.id });
  const target = await getWorkspaceAgentController(agent, runtimeOptions);
  if (model) await target.configure({ model });
  if (sourceSettings?.thinkingLevel) await target.configure({ thinkingLevel: sourceSettings.thinkingLevel });
  await events?.emit("workspace_agent_view_invalidated", { workspaceId: agent.workspaceId, conversationId: agent.conversationId });
}

export const builtinAgentWorkspaceModule: WorkspaceModule = {
  id: "builtin-agent",
  cableChannels: [{
    name: "agent",
    async subscribe(identifier, listener, events) {
      if (identifier.channel !== "agent") throw new Error("Invalid Agent channel identifier");
      const agent = await resolveAgentConversation(identifier.workspaceId, identifier.conversationId);
      const runtime = await getWorkspaceAgentPresentation(agent, { events });
      return runtime.subscribeLivePresentation(listener);
    },
  }, {
    name: "agent-turn",
    async subscribe(identifier, listener, events) {
      if (identifier.channel !== "agent-turn") throw new Error("Invalid Agent turn channel identifier");
      const agent = await resolveAgentConversation(identifier.workspaceId, identifier.conversationId);
      const runtime = await getWorkspaceAgentPresentation(agent, { events });
      return runtime.subscribeTurnPresentation(identifier.turnId, identifier.branchId, listener);
    },
  }],
  openApiPaths: {
    "/agent-notifications/public-key": { get: {
      summary: "Get this AgentsInTheCloud installation's VAPID public key for browser PushManager subscription",
      responses: { "200": { description: "Public application-server key", content: { "application/json": { schema: { type: "object", properties: { publicKey: { type: "string" } } } } } } },
    } },
    "/workspaces/{id}/agents/{conversationId}/notification": {
      parameters: ["id", "conversationId"].map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
      get: {
        summary: "Get the current turn's one-shot notification state",
        responses: { "200": { description: "Current turnId (null when idle), busy and armed; HTML clients receive the header control", content: { "application/json": { schema: { type: "object", properties: { turnId: { type: ["string", "null"] }, busy: { type: "boolean" }, armed: { type: "boolean" } } } } } } },
      },
      post: {
        summary: "Arm or cancel a native Web Push notification for this exact running turn",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", required: ["turnId", "enabled"], properties: {
            turnId: { type: "string" }, enabled: { type: "boolean" },
            subscription: { type: "object", description: "Required when enabled; PushSubscription.toJSON() from the receiving device", required: ["endpoint", "keys"], properties: { endpoint: { type: "string" }, keys: { type: "object", required: ["p256dh", "auth"], properties: { p256dh: { type: "string" }, auth: { type: "string" } } } } },
          },
        } } } },
        responses: { "200": { description: "Notification state updated; JSON or Turbo Stream according to Accept" }, "409": { description: "The requested turn is no longer running" }, "422": { description: "Invalid notification intent or unsupported push service" } },
      },
    },
    "/workspaces/{id}/agents/{conversationId}/tools/{callId}/abort": { post: {
      summary: "Abort one live tool call and its owned work without stopping the agent turn",
      parameters: ["id", "conversationId", "callId"].map(name => ({ name, in: "path", required: true, schema: { type: "string" } })),
      responses: { "200": { description: "Cancellation requested; aborted is false if the call is no longer active. HTML clients receive a Turbo Stream.", content: { "application/json": { schema: { type: "object", properties: { tool: { type: "object", required: ["callId", "aborted"], properties: { callId: { type: "string" }, aborted: { type: "boolean" } } } } } } } } },
    } },
    "/workspaces/{id}/agents/{conversationId}/reveal/{target}": { get: {
      summary: "Resolve the enclosing turn for a transcript navigation target",
      parameters: ["id", "conversationId", "target"].map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
      responses: { "200": { description: "Enclosing turn identity for browser-local navigation", content: { "application/json": { schema: { type: "object", properties: { turnId: { type: ["string", "null"] } } } } } } },
    } },
  },
  routes: [{
    async handle(request, url, context) {
      // SAFETY: The module boundary validates or constructs this value with the asserted domain shape.
      return handleAgentRequest(request, url, { events: context.events as AgentsInTheCloudEventBus | undefined, renderPage: context.renderPage });
    },
  }],
  agentProvider: {
    id: "builtin", label: "Builtin", iconHtml: builtinAgentIconHtml,
    tabs: workspaceAgentTabProvider,
    create: createBuiltinAgent,
    launch: nativeAgentLaunch,
  },
  initialize(context) {
    // SAFETY: The module boundary validates or constructs this value with the asserted domain shape.
    const events = context.events as AgentsInTheCloudEventBus;
    agentEvents = events;
    registerAgentEvents(events);
    events.on("workspace_agent_turn_finished", async ({ workspaceId, conversationId }) => {
      const agent = (await listWorkspaceAgentConversations(workspaceId)).find((item) => item.conversationId === conversationId);
      context.registry.requestSurfaceAttention(workspaceId, agentConversationKey(conversationId));
      // Delegated conversations finish independently of the root's turn. Their
      // completion belongs to the Agent surface, not workspace-level attention.
      if (agent) context.registry.requestAttention(workspaceId);
      context.invalidateWorkspace(workspaceId);
      await refreshWorkspaceCompletionCatalogs(workspaceId);
    });
    context.onWorkspaceRemoved(removeWorkspaceInitialPromptDrafts);
  },
  attachToWorkspace() {
    return { commands: [launchComposerCommandContribution] };
  },
};

async function createBuiltinAgent({ workspaceId, events }: { workspaceId: string; events?: AgentsInTheCloudEventBus }): Promise<string> {
  const sourceConversation = (await listWorkspaceAgentConversations(workspaceId))[0];
  const conversation = await createNextWorkspaceAgentConversation(workspaceId);
  const applySettingsTimer = setTimeout(() => {
    void applyNewAgentSettings(conversation, sourceConversation, events).catch((error) => console.error("Could not apply settings to new Agent conversation", error));
  }, 0);
  applySettingsTimer.unref?.();
  return conversation.conversationId;
}
