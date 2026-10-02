import { expect, test } from "bun:test";
import { getWorkspaceAgentPresentation, closeWorkspaceAgentConversation, removeWorkspaceAgentRuntimes } from "../../src/server/runtime.ts";

test("removed Workspace runtimes cannot be recreated by stale Agent requests", async () => {
  await removeWorkspaceAgentRuntimes("removed-runtime-test");

  expect(() => getWorkspaceAgentPresentation({ workspaceId: "removed-runtime-test", conversationId: "conversation", label: "Agent 1", title: "Agent", path: "/tmp/removed-session.jsonl" })).toThrow("workspace not found");
});

test("closed conversation runtimes cannot be recreated during the dispose-to-archive gap", async () => {
  const agent = { workspaceId: "closed-runtime-test", conversationId: "53fc77b7-dc19-42d5-b200-2e134ec67529", label: "Agent 1", title: "Agent", path: "/tmp/closed-session.jsonl" };

  await closeWorkspaceAgentConversation(agent.workspaceId, agent.conversationId);

  expect(() => getWorkspaceAgentPresentation(agent)).toThrow("Agent conversation not found");
});
