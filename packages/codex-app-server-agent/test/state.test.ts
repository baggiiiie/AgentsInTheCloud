import { expect, test } from "bun:test";
import { CodexState } from "../src/server/state.ts";
import type {
  Turn,
  ThreadItem,
} from "../src/protocol.ts";

function turn(id = "turn"): Turn { return { id, items: [], itemsView: "full", status: "inProgress", error: null, startedAt: 100, completedAt: null, durationMs: null }; }
function message(text: string): ThreadItem { return { type: "agentMessage", id: "answer", text, phase: "final_answer", memoryCitation: null, delivery: null, questions: null }; }

test("final native snapshots replace streaming text without duplicating it", () => {
  const state = new CodexState();
  state.receive({ method: "turn/started", params: { threadId: "thread", turn: turn() } });
  state.receive({ method: "item/started", params: { threadId: "thread", turnId: "turn", item: message(""), startedAtMs: 100000 } });
  state.receive({ method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn", itemId: "answer", delta: "Hello" } });
  state.receive({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: message("Hello world"), completedAtMs: 103000 } });
  expect(state.turns[0]!.items).toEqual([message("Hello world")]);
  expect(state.completedItems.has("answer")).toBe(true);
  state.receive({ method: "turn/completed", params: { threadId: "thread", turn: { ...turn(), status: "completed", completedAt: 103, durationMs: 3000 } } });
  expect(state.activeTurn).toBeUndefined();
  expect(state.turns[0]!.items).toEqual([message("Hello world")]);
});

test("active hydration adds canonical user inputs without replaying text deltas", () => {
  const state = new CodexState();
  state.hydrate([{ ...turn(), items: [message("already streamed")] }]);
  const user: ThreadItem = { type: "userMessage", id: "user", clientId: "request", content: [{ type: "text", text: "hello", text_elements: [] }] };
  state.hydrateItems("turn", [user, message("older partial")], false);
  expect(state.turns[0]!.items).toEqual([user, message("already streamed")]);
  state.hydrateItems("turn", [user, message("complete")], true);
  expect(state.turns[0]!.items).toEqual([user, message("complete")]);
});

test("interrupted and failed turns are not treated as active work", () => {
  const state = new CodexState();
  state.hydrate([{ ...turn(), status: "interrupted" }, { ...turn("failed"), status: "failed", error: { message: "Provider failed", codexErrorInfo: null, additionalDetails: null, misalignment: null } }]);
  expect(state.activeTurn).toBeUndefined();
  expect(state.turns[1]!.error?.message).toBe("Provider failed");
});

test("a delta without its native item is a protocol error", () => {
  const state = new CodexState();
  state.hydrate([turn()]);
  expect(() => state.receive({ method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn", itemId: "missing", delta: "text" } })).toThrow("unknown item");
});

test("replacing native history discards completion flags from the previous session", () => {
  const state = new CodexState();
  state.hydrate([{ ...turn(), status: "completed", items: [message("done")] }]);
  expect(state.completedItems.has("answer")).toBe(true);
  state.hydrate([turn("fresh")]);
  expect(state.completedItems.size).toBe(0);
  expect(state.activeTurn?.id).toBe("fresh");
});
