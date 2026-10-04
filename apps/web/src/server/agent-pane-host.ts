import { AgentsInTheCloudCoreError, agentsInTheCloudDataPath, createKeyedOperationQueue, getAgentsInTheCloudRuntimeContext, readTextIfExists, writeJsonAtomic } from "@agents-in-the-cloud/core";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { WorkspaceAgentProvider, WorkspaceAgentTabSummary } from "@agents-in-the-cloud/shared";

const tabOrderSchema = Type.Array(Type.String());

export interface HostedAgentTab extends WorkspaceAgentTabSummary {
  providerId: string;
  iconHtml: string;
}

/** The host routes globally unique conversation identities without interpreting provider storage. */
export function createAgentPaneHost(providers: readonly WorkspaceAgentProvider[]) {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  if (byId.size !== providers.length) throw new Error("Duplicate agent provider identity");

  const serialize = createKeyedOperationQueue();

  async function list(context: { workspaceId: string }): Promise<HostedAgentTab[]> {
    return serialize(context.workspaceId, async () => {
      const tabs = (await Promise.all(providers.map(async (provider) =>
        (await provider.tabs.list(context)).map((tab) => ({ ...tab, providerId: provider.id, iconHtml: provider.iconHtml })),
      ))).flat();
      const byConversation = new Map(tabs.map(tab => [tab.id, tab]));
      if (byConversation.size !== tabs.length) throw new Error("Duplicate agent conversation identity");
      const path = agentsInTheCloudDataPath(getAgentsInTheCloudRuntimeContext(), "workspaces", context.workspaceId, "metadata", "agent-tab-order.json");
      const content = await readTextIfExists(path);
      const saved: unknown = content === undefined ? [] : JSON.parse(content);
      Value.Assert(tabOrderSchema, saved);
      const order = [
        ...saved.filter(id => byConversation.has(id)),
        ...tabs.filter(tab => !saved.includes(tab.id)).map(tab => tab.id),
      ];
      if (order.length !== saved.length || order.some((id, index) => id !== saved[index])) await writeJsonAtomic(path, order);
      return order.map(id => byConversation.get(id)!);
    });
  }

  async function owner(context: { workspaceId: string; conversationId: string }) {
    const tab = (await list(context)).find((tab) => tab.id === context.conversationId);
    if (!tab) throw new AgentsInTheCloudCoreError("agent_conversation_not_found", `Agent conversation not found: ${context.conversationId}`);
    return byId.get(tab.providerId)!;
  }

  return {
    list,
    async render(context: { workspaceId: string; conversationId: string }) {
      return (await owner(context)).tabs.render(context);
    },
    async close(context: { workspaceId: string; conversationId: string }) {
      return (await owner(context)).tabs.close(context);
    },
  };
}
