import { createKeyedOperationQueue, type AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import { errorMessage } from "@agents-in-the-cloud/shared";
import { getWorkspaceTitle, listWorkspaces, setWorkspaceTitle } from "@agents-in-the-cloud/workspace";
import { resolveNewWorkspaceAgentModel } from "@agents-in-the-cloud/agent/server/model-state";
import { cheapestAvailableProviderModel, claudeCodeHeaders, createPiModelRuntime, type ModelRef } from "@agents-in-the-cloud/llm/server";
import { listWorkspaceAgents, setWorkspaceAgentTitle, untitledAgentTitle, type WorkspaceAgentInfo } from "./agent-store.ts";

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
const automaticallyNameAgent = createAutomaticWorkspaceNamingGate();
const serializeTitleOperation = createKeyedOperationQueue();

async function workspaceShouldFollowAgentTitle(workspaceId: string, agentTitle: string): Promise<boolean> {
  const { workspaces } = await listWorkspaces();
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
  return workspace?.title === null || workspace?.title === agentTitle;
}

interface AgentTitleStore {
  listAgents(workspaceId: string): Promise<WorkspaceAgentInfo[]>;
  setAgentTitle(agent: WorkspaceAgentInfo, title: string): Promise<WorkspaceAgentInfo>;
  workspaceShouldFollowAgentTitle(workspaceId: string, agentTitle: string): Promise<boolean>;
  setWorkspaceTitle(workspaceId: string, title: string): Promise<void>;
}

export function createAgentTitleSetter(store: AgentTitleStore) {
  return async (agent: WorkspaceAgentInfo, title: string, options: { events?: AgentsInTheCloudEventBus; onlyIfUnnamed?: boolean } = {}): Promise<WorkspaceAgentInfo> => {
    const result = await serializeTitleOperation(agent.workspaceId, async () => {
      const current = (await store.listAgents(agent.workspaceId)).find((candidate) => candidate.agentId === agent.agentId);
      if (!current) throw new Error(`Agent not found: ${agent.agentId}`);
      if (options.onlyIfUnnamed && current.title !== untitledAgentTitle) return { agent: current, workspaceNamed: false, unchanged: true };
      const renamed = await store.setAgentTitle(current, title);
      const workspaceShouldFollow = await store.workspaceShouldFollowAgentTitle(agent.workspaceId, current.title);
      if (workspaceShouldFollow) await store.setWorkspaceTitle(agent.workspaceId, title);
      return { agent: renamed, workspaceNamed: workspaceShouldFollow };
    });
    if (result.unchanged) return result.agent;
    await options.events?.emit("workspace_agent_title_changed", { workspaceId: agent.workspaceId, agentId: agent.agentId, title });
    if (result.workspaceNamed) await options.events?.emit("workspace_title_changed", { workspaceId: agent.workspaceId, title });
    return result.agent;
  };
}

export const setAgentTitle = createAgentTitleSetter({
  listAgents: listWorkspaceAgents,
  setAgentTitle: setWorkspaceAgentTitle,
  workspaceShouldFollowAgentTitle,
  setWorkspaceTitle: async (workspaceId, title) => { await setWorkspaceTitle(workspaceId, title); },
});

interface AgentTitleSuggestionErrorDetails {
  stopReason?: string;
  diagnostics?: unknown;
  responseText?: string;
  error?: unknown;
}

function logAgentTitleSuggestionError(agent: { workspaceId: string; agentId?: string }, model: ModelRef | undefined, message: string, details: AgentTitleSuggestionErrorDetails = {}): void {
  console.error("could not suggest Agent title", { workspaceId: agent.workspaceId, agentId: agent.agentId, model: model ? `${model.provider}/${model.id}` : undefined, message, ...details });
}

function suggestAgentTitle(agent: { workspaceId: string; agentId?: string }, userMessages: string[], options: { events?: AgentsInTheCloudEventBus; agentModel?: ModelRef }): void {
  const promptText = userMessages.map((message) => message.trim()).filter(Boolean).join("\n\n");
  if (!promptText) return;

  const suggest = async (): Promise<boolean> => {
    let titleModelRef = options.agentModel;
    try {
      // The persisted title also suppresses automatic naming after a server restart.
      if (agent.agentId) {
        const currentAgent = (await listWorkspaceAgents(agent.workspaceId)).find((candidate) => candidate.agentId === agent.agentId);
        if (!currentAgent) throw new Error(`Agent not found: ${agent.agentId}`);
        if (currentAgent.title !== untitledAgentTitle) return true;
      } else if (await getWorkspaceTitle(agent.workspaceId) !== null) return true;
      if (!titleModelRef && !agent.agentId) titleModelRef = await resolveNewWorkspaceAgentModel();
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
      }, { ...agentTitleRequestOptions, headers: claudeCodeHeaders(model), sessionId: crypto.randomUUID() });
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
          logAgentTitleSuggestionError(agent, titleModelRef, "model returned an unusable Agent title", { responseText, stopReason: response.stopReason });
        }
        return false;
      }
      if (!agent.agentId) {
        await serializeTitleOperation(agent.workspaceId, async () => {
          // Recheck after the LLM returns: a manual title always wins.
          if (await getWorkspaceTitle(agent.workspaceId) !== null) return;
          await setWorkspaceTitle(agent.workspaceId, title);
          await options.events?.emit("workspace_title_changed", { workspaceId: agent.workspaceId, title });
          const agents = await listWorkspaceAgents(agent.workspaceId);
          const firstAgent = agents[0];
          if (firstAgent?.title === untitledAgentTitle) {
            await setWorkspaceAgentTitle(firstAgent, title);
            await options.events?.emit("workspace_agent_title_changed", { workspaceId: agent.workspaceId, agentId: firstAgent.agentId, title });
          }
        });
      } else {
        const currentAgent = (await listWorkspaceAgents(agent.workspaceId)).find((candidate) => candidate.agentId === agent.agentId)!;
        await setAgentTitle(currentAgent, title, { events: options.events, onlyIfUnnamed: true });
      }
      return true;
    } catch (error) {
      logAgentTitleSuggestionError(agent, titleModelRef, errorMessage(error), { error });
      return false;
    }
  };
  if (agent.agentId) {
    void automaticallyNameAgent(`${agent.workspaceId}:${agent.agentId}`, suggest);
  } else {
    void automaticallyNameWorkspace(agent.workspaceId, suggest);
  }
}

export function maybeNameAgentFromPrompt(agent: WorkspaceAgentInfo, userMessages: string[], options: { events?: AgentsInTheCloudEventBus; agentModel?: ModelRef } = {}): void {
  suggestAgentTitle(agent, userMessages, options);
}

export function maybeNameWorkspaceFromPrompt(workspaceId: string, prompt: string, options: { events?: AgentsInTheCloudEventBus; agentModel?: ModelRef } = {}): void {
  suggestAgentTitle({ workspaceId }, [prompt], options);
}
