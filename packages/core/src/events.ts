export interface AgentSystemPromptPrepareEvent {
  workspaceId: string;
  conversationId: string;
  lines: string[];
}

export interface AgentsInTheCloudHostStartedEvent {
  workspaces: Array<{ id: string; parked: boolean }>;
}

export interface AgentsInTheCloudEventMap {
  agent_system_prompt_prepare: AgentSystemPromptPrepareEvent;
  agents_in_the_cloud_host_started: AgentsInTheCloudHostStartedEvent;
}

export type AgentsInTheCloudEventHandler<K extends keyof AgentsInTheCloudEventMap> = (event: AgentsInTheCloudEventMap[K]) => void | Promise<void>;

export interface AgentsInTheCloudEventBus {
  on<K extends keyof AgentsInTheCloudEventMap>(eventName: K, handler: AgentsInTheCloudEventHandler<K>): () => void;
  emit<K extends keyof AgentsInTheCloudEventMap>(eventName: K, event: AgentsInTheCloudEventMap[K]): Promise<void>;
}

export function createAgentsInTheCloudEventBus(): AgentsInTheCloudEventBus {
  const handlers = new Map<keyof AgentsInTheCloudEventMap, Set<AgentsInTheCloudEventHandler<any>>>();

  return {
    on(eventName, handler) {
      const eventHandlers = handlers.get(eventName) ?? new Set<AgentsInTheCloudEventHandler<typeof eventName>>();
      handlers.set(eventName, eventHandlers);
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },

    async emit(eventName, event) {
      const eventHandlers = handlers.get(eventName);
      if (!eventHandlers) return;
      for (const handler of eventHandlers) {
        await handler(event);
      }
    },
  };
}
