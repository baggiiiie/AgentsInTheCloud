import { createKeyedOperationQueue, type AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import { errorMessage } from "@agents-in-the-cloud/shared";
import { getWorkspaceTitle, listWorkspaces, setWorkspaceTitle } from "@agents-in-the-cloud/workspace";
import { resolveNewWorkspaceAgentModel } from "@agents-in-the-cloud/agent/server/model-state";
import { cheapestAvailableProviderModel, claudeCodeHeaders, createPiModelRuntime, type ModelRef } from "@agents-in-the-cloud/llm/server";
import { listWorkspaceAgentConversations, setWorkspaceAgentConversationTitle, untitledAgentConversationTitle, type WorkspaceAgentConversationInfo } from "./session-store.ts";

/**
 * A slug needs no reasoning, and asking for one shrinks the answer room a thinking
 * budget would need: Anthropic rejects the resulting sub-1024 token budget outright.
 */
import { agentTitleRequestOptions, normalizeSlug, promptFor, textFromResponse } from "@agents-in-the-cloud/agent/server/slug-suggestion";

export function createAutomaticWorkspaceNamingGate() {
  const active = new Set<string>();
  const completed = new Set<string>();
  return async (workspaceId: string, name: () => Promise<boolean>): Promise<void> => {
    if (active.has(workspaceId) || completed.has(workspaceId)) return;
    active.add(workspaceId);
    try {
      if (await name()) completed.add(workspaceId);
    } finally {
      active.delete(workspaceId);
    }
  };
}

const automaticallyNameWorkspace = createAutomaticWorkspaceNamingGate();
const automaticallyNameConversation = createAutomaticWorkspaceNamingGate();
const serializeTitleOperation = createKeyedOperationQueue();

async function workspaceShouldFollowAgentTitle(workspaceId: string, agentTitle: string): Promise<boolean> {
  const { workspaces } = await listWorkspaces();
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
  return workspace?.title === null || workspace?.title === agentTitle;
}

interface AgentSessionTitleStore {
  listConversations(workspaceId: string): Promise<WorkspaceAgentConversationInfo[]>;
  setConversationTitle(agent: WorkspaceAgentConversationInfo, title: string): Promise<WorkspaceAgentConversationInfo>;
  workspaceShouldFollowAgentTitle(workspaceId: string, agentTitle: string): Promise<boolean>;
  setWorkspaceTitle(workspaceId: string, title: string): Promise<void>;
}

export function createAgentSessionTitleSetter(store: AgentSessionTitleStore) {
  return async (agent: WorkspaceAgentConversationInfo, title: string, options: { events?: AgentsInTheCloudEventBus; onlyIfUnnamed?: boolean } = {}): Promise<WorkspaceAgentConversationInfo> => {
    const result = await serializeTitleOperation(agent.workspaceId, async () => {
      const current = (await store.listConversations(agent.workspaceId)).find((candidate) => candidate.conversationId === agent.conversationId);
      if (!current) throw new Error(`Agent conversation not found: ${agent.conversationId}`);
      if (options.onlyIfUnnamed && current.title !== untitledAgentConversationTitle) return { agent: current, workspaceNamed: false, unchanged: true };
      const renamed = await store.setConversationTitle(current, title);
      const workspaceShouldFollow = await store.workspaceShouldFollowAgentTitle(agent.workspaceId, current.title);
      if (workspaceShouldFollow) await store.setWorkspaceTitle(agent.workspaceId, title);
      return { agent: renamed, workspaceNamed: workspaceShouldFollow };
    });
    if (result.unchanged) return result.agent;
    await options.events?.emit("workspace_agent_conversation_title_changed", { workspaceId: agent.workspaceId, conversationId: agent.conversationId, title });
    if (result.workspaceNamed) await options.events?.emit("workspace_title_changed", { workspaceId: agent.workspaceId, title });
    return result.agent;
  };
}

export const setAgentSessionTitle = createAgentSessionTitleSetter({
  listConversations: listWorkspaceAgentConversations,
  setConversationTitle: setWorkspaceAgentConversationTitle,
  workspaceShouldFollowAgentTitle,
  setWorkspaceTitle: async (workspaceId, title) => { await setWorkspaceTitle(workspaceId, title); },
});

interface AgentTitleSuggestionErrorDetails {
  stopReason?: string;
  diagnostics?: unknown;
  responseText?: string;
  error?: unknown;
}

function logAgentTitleSuggestionError(agent: { workspaceId: string; conversationId?: string }, model: ModelRef | undefined, message: string, details: AgentTitleSuggestionErrorDetails = {}): void {
  console.error("could not suggest Agent session title", { workspaceId: agent.workspaceId, conversationId: agent.conversationId, model: model ? `${model.provider}/${model.id}` : undefined, message, ...details });
}

function suggestAgentTitle(agent: { workspaceId: string; conversationId?: string }, userMessages: string[], options: { events?: AgentsInTheCloudEventBus; agentModel?: ModelRef }): void {
  const promptText = userMessages.map((message) => message.trim()).filter(Boolean).join("\n\n");
  if (!promptText) return;

  const suggest = async (): Promise<boolean> => {
    let titleModelRef = options.agentModel;
    try {
      // The persisted title also suppresses automatic naming after a server restart.
      if (agent.conversationId) {
        const conversation = (await listWorkspaceAgentConversations(agent.workspaceId)).find((candidate) => candidate.conversationId === agent.conversationId);
        if (!conversation) throw new Error(`Agent conversation not found: ${agent.conversationId}`);
        if (conversation.title !== untitledAgentConversationTitle) return true;
      } else if (await getWorkspaceTitle(agent.workspaceId) !== null) return true;
      if (!titleModelRef && !agent.conversationId) titleModelRef = await resolveNewWorkspaceAgentModel();
      if (!titleModelRef) {
        logAgentTitleSuggestionError(agent, undefined, "agent model is not selected");
        return false;
      }
      const runtime = await createPiModelRuntime();
      const model = await cheapestAvailableProviderModel(runtime, titleModelRef.provider);
      if (!model) {
        logAgentTitleSuggestionError(agent, titleModelRef, "provider has no models available");
        return false;
      }
      titleModelRef = { provider: model.provider, id: model.id };
      if (!(await runtime.checkAuth(model.provider))) {
        logAgentTitleSuggestionError(agent, titleModelRef, "model authentication is not configured");
        return false;
      }
      const response = await runtime.completeSimple(model, {
        messages: [{ role: "user", content: promptFor(promptText), timestamp: Date.now() }],
      }, { ...agentTitleRequestOptions, headers: claudeCodeHeaders(model) });
      if (response.stopReason === "error") {
        logAgentTitleSuggestionError(agent, titleModelRef, response.errorMessage ?? "model returned an error", {
          stopReason: response.stopReason,
          diagnostics: response.diagnostics,
        });
        return false;
      }
      const responseText = textFromResponse(response);
      const title = normalizeSlug(responseText);
      if (!title) {
        if (responseText.toLowerCase() !== "error") {
          logAgentTitleSuggestionError(agent, titleModelRef, "model returned an unusable Agent session title", { responseText, stopReason: response.stopReason });
        }
        return false;
      }
      if (!agent.conversationId) {
        await serializeTitleOperation(agent.workspaceId, async () => {
          // Recheck after the LLM returns: a manual title always wins.
          if (await getWorkspaceTitle(agent.workspaceId) !== null) return;
          await setWorkspaceTitle(agent.workspaceId, title);
          await options.events?.emit("workspace_title_changed", { workspaceId: agent.workspaceId, title });
          const conversations = await listWorkspaceAgentConversations(agent.workspaceId);
          const conversation = conversations[0];
          if (conversation?.title === untitledAgentConversationTitle) {
            await setWorkspaceAgentConversationTitle(conversation, title);
            await options.events?.emit("workspace_agent_conversation_title_changed", { workspaceId: agent.workspaceId, conversationId: conversation.conversationId, title });
          }
        });
      } else {
        const conversation = (await listWorkspaceAgentConversations(agent.workspaceId)).find((candidate) => candidate.conversationId === agent.conversationId)!;
        await setAgentSessionTitle(conversation, title, { events: options.events, onlyIfUnnamed: true });
      }
      return true;
    } catch (error) {
      logAgentTitleSuggestionError(agent, titleModelRef, errorMessage(error), { error });
      return false;
    }
  };
  if (agent.conversationId) {
    void automaticallyNameConversation(`${agent.workspaceId}:${agent.conversationId}`, suggest);
  } else {
    void automaticallyNameWorkspace(agent.workspaceId, suggest);
  }
}

export function maybeNameAgentFromPrompt(agent: WorkspaceAgentConversationInfo, userMessages: string[], options: { events?: AgentsInTheCloudEventBus; agentModel?: ModelRef } = {}): void {
  suggestAgentTitle(agent, userMessages, options);
}

export function maybeNameWorkspaceFromPrompt(workspaceId: string, prompt: string, options: { events?: AgentsInTheCloudEventBus; agentModel?: ModelRef } = {}): void {
  suggestAgentTitle({ workspaceId }, [prompt], options);
}
