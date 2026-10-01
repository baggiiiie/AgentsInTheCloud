import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createAgentSession, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { observeExtensionStatusEvents, type ExtensionStatusEvent } from "../../src/server/extension-status-events.ts";
import { createAtelierResourceLoader } from "../../src/server/system-prompt.ts";

test("extension status observation preserves dispatch, connector warnings, baseline registrations, and cleanup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atelier-mcp-observer-"));
  const resourceLoader = createAtelierResourceLoader();
  const { session } = await createAgentSession({
    cwd: dir, agentDir: dir, resourceLoader,
    sessionManager: SessionManager.inMemory(dir),
    settingsManager: SettingsManager.inMemory(), tools: [],
  });
  const runner = session.extensionRunner;
  const registry = resourceLoader.getExtensions().runtime.mcpServers;
  const errors: string[] = [];
  const unsubscribeErrors = runner.onError(error => errors.push(error.event));
  const changes: ExtensionStatusEvent[] = [];
  const originalEmit = runner.emit;
  registry.register({ name: "existing", config: { command: "unused" }, extensionPath: "sample" });
  const detach = observeExtensionStatusEvents(session, change => changes.push(change));
  try {
    expect(resourceLoader.getExtensions().runtime.mcpServers).toBe(registry);
    expect(changes).toEqual([]);
    expect(session.hasExtensionHandlers("mcp_servers_change")).toBe(false);
    registry.register({ name: "docs", config: { command: "unused" }, extensionPath: "sample" });
    registry.register({ name: "docs", config: { command: "replacement" }, extensionPath: "sample" });
    registry.unregister("existing", "someone-else");
    registry.unregister("existing", "sample");
    await Promise.resolve();
    expect(changes).toEqual([
      { type: "mcp_servers_change", added: ["docs"], removed: [], registered: 2 },
      { type: "mcp_servers_change", added: [], removed: [], registered: 2 },
      { type: "mcp_servers_change", added: [], removed: ["existing"], registered: 1 },
    ]);
    expect(errors).toEqual(["register_mcp_server", "register_mcp_server"]);
    await runner.emit({ type: "session_info_changed", name: "sample" });
    expect(changes).toHaveLength(3);
    const tree = { type: "session_tree" as const, newLeafId: "new", oldLeafId: "old" };
    await runner.emit(tree);
    expect(changes.at(-1)).toEqual(tree);
    detach();
    expect(runner.emit).toBe(originalEmit);
    registry.unregister("docs", "sample");
    await runner.emit(tree);
    expect(changes).toHaveLength(4);
  } finally {
    detach();
    unsubscribeErrors();
    session.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
