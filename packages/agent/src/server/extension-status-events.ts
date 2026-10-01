import type { AgentSession, ExtensionEvent } from "@earendil-works/pi-coding-agent";

interface McpServerChange {
  type: "mcp_servers_change";
  added: string[];
  removed: string[];
  registered: number;
}

export type ExtensionStatusEvent = McpServerChange | Extract<ExtensionEvent, { type: "session_tree" }>;

/** Observe status events without installing connector or policy-changing handlers. */
export function observeExtensionStatusEvents(session: AgentSession, listener: (event: ExtensionStatusEvent) => void): () => void {
  const runner = session.extensionRunner;
  const originalEmit = runner.emit;
  const emit = originalEmit.bind(runner);
  let active = true;
  const notify = (event: ExtensionStatusEvent) => queueMicrotask(() => {
    if (active) listener(event);
  });
  let names = new Set(session.resourceLoader.getExtensions().runtime.mcpServers.list().map(server => server.name));
  runner.emit = event => {
    const result = emit(event);
    if (event.type === "mcp_servers_change") {
      const next = new Set(event.servers.map(server => server.name));
      const added = [...next].filter(name => !names.has(name));
      const removed = [...names].filter(name => !next.has(name));
      names = next;
      notify({ type: "mcp_servers_change", added, removed, registered: next.size });
    } else if (event.type === "session_tree") {
      notify(event);
    }
    return result;
  };
  return () => {
    active = false;
    runner.emit = originalEmit;
  };
}
