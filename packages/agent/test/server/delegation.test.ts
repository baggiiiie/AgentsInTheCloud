import { afterEach, expect, test } from "bun:test";
import { configureAgentDelegation, type AgentDelegation } from "../../src/server/delegation.ts";
import { closeWorkspaceAgentConversation, unloadWorkspaceAgentRuntime, removeWorkspaceAgentRuntimes, restoreWorkspaceAgentRuntime } from "../../src/server/runtime.ts";
import { recordsFromSessionEntries } from "../../src/server/session-records.ts";

const delegation: AgentDelegation = {
  prepare: () => ({}),
  resolveConversation: async () => undefined,
  closingConversation: async () => {},
  removingWorkspace: async () => {},
  projectSessionEntry: () => undefined,
};
afterEach(() => configureAgentDelegation(undefined));

test("unloading does not close delegation; explicit close and workspace removal await it", async () => {
  const operations: string[] = [];
  configureAgentDelegation({
    ...delegation,
    async closingConversation(workspaceId, conversationId) { await Promise.resolve(); operations.push(`close:${workspaceId}:${conversationId}`); },
    async removingWorkspace(workspaceId) { await Promise.resolve(); operations.push(`remove:${workspaceId}`); },
  });
  await unloadWorkspaceAgentRuntime("delegation-lifecycle", "root");
  expect(operations).toEqual([]);
  await closeWorkspaceAgentConversation("delegation-lifecycle", "root");
  expect(operations).toEqual(["close:delegation-lifecycle:root"]);
  await removeWorkspaceAgentRuntimes("delegation-lifecycle");
  expect(operations).toEqual(["close:delegation-lifecycle:root", "remove:delegation-lifecycle"]);
});

test("delegation close failures reach the caller rather than permitting archival", async () => {
  configureAgentDelegation({ ...delegation, async closingConversation() { throw new Error("could not close descendants"); } });
  try {
    await expect(closeWorkspaceAgentConversation("delegation-close-failure", "root")).rejects.toThrow("could not close descendants");
  } finally { restoreWorkspaceAgentRuntime("delegation-close-failure", "root"); }
});

test("delegation consumes its records; without it ordinary custom history remains readable", () => {
  const entry = { type: "custom_message", customType: "task", id: "turn", timestamp: "2026-01-01T00:00:00Z", content: "Task body", display: true };
  configureAgentDelegation({ ...delegation, projectSessionEntry(value) {
    if (value.customType === "task") return [{ kind: "taskStart", id: value.id, timestamp: Date.parse(value.timestamp) }];
  } });
  expect(recordsFromSessionEntries([entry])).toEqual([{ kind: "taskStart", id: "turn", timestamp: Date.parse(entry.timestamp) }]);
  configureAgentDelegation(undefined);
  expect(recordsFromSessionEntries([entry])).toEqual([{ kind: "note", id: "turn", timestamp: Date.parse(entry.timestamp), text: "Task body", tone: "summary" }]);
});
