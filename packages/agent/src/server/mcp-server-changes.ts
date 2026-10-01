import type { AgentSession } from "@earendil-works/pi-coding-agent";

export interface McpServerChange {
  added: string[];
  removed: string[];
  registered: number;
}

/** Observe registrations without marking Atelier as the extension that connects them. */
export function observeMcpServerChanges(session: AgentSession, listener: (change: McpServerChange) => void): () => void {
  const runner = session.extensionRunner;
  const originalEmit = runner.emit;
  const emit = originalEmit.bind(runner);
  let names = new Set(session.resourceLoader.getExtensions().runtime.mcpServers.list().map(server => server.name));
  runner.emit = event => {
    const result = emit(event);
    if (event.type === "mcp_servers_change") {
      const next = new Set(event.servers.map(server => server.name));
      const added = [...next].filter(name => !names.has(name));
      const removed = [...names].filter(name => !next.has(name));
      names = next;
      listener({ added, removed, registered: next.size });
    }
    return result;
  };
  return () => { runner.emit = originalEmit; };
}
