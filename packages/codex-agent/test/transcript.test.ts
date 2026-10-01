import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexResumeId, codexTranscriptRecords, loadCodexTranscript, loadCodexTranscriptImage } from "../src/server/transcript.ts";

function row(type: string, payload: Record<string, string | number | Array<Record<string, string>>>) { return JSON.stringify({ type, timestamp: "2026-01-01T00:00:00Z", payload }); }

test("projects native Codex response items without duplicating event messages or developer instructions", () => {
  const lines = [
    row("session_meta", { type: "session_meta" }),
    row("response_item", { type: "message", role: "developer", content: [{ type: "input_text", text: "secret" }] }),
    row("response_item", { type: "message", role: "user", id: "u", content: [{ type: "input_text", text: "Find it" }] }),
    row("event_msg", { type: "agent_message", message: "duplicate" }),
    row("response_item", { type: "reasoning", summary: [{ type: "summary_text", text: "Search first" }] }),
    row("response_item", { type: "function_call", name: "exec_command", call_id: "call", arguments: JSON.stringify({ cmd: "ls" }) }),
    row("response_item", { type: "function_call_output", call_id: "call", output: "file.ts" }),
    row("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "Found it" }] }),
    '{"type":"response_item"',
  ].join("\n");
  const records = codexTranscriptRecords(lines);
  expect(records.map((record) => record.kind)).toEqual(["user", "assistant", "assistant", "toolResult", "assistant"]);
  expect(records[1]).toMatchObject({ parts: [{ type: "thinking", text: "Search first" }] });
  expect(records[2]).toMatchObject({ parts: [{ type: "toolCall", name: "bash", args: { command: "ls" } }] });
  expect(records[3]).toMatchObject({ text: "file.ts", callId: "call" });
});

test("recognizes only direct shell invocations inside Codex's JavaScript exec tool", () => {
  const lines = [
    row("response_item", { type: "message", role: "user", id: "u", content: [{ type: "input_text", text: "Inspect the directory" }] }),
    row("response_item", { type: "custom_tool_call", name: "exec", call_id: "shell", input: 'text(await tools.exec_command({cmd:"ls -la /work",max_output_tokens:1000}));' }),
    row("response_item", { type: "custom_tool_call_output", call_id: "shell", output: [
      { type: "input_text", text: "Script completed\\nOutput:" },
      { type: "input_text", text: JSON.stringify({ exit_code: 1, output: "missing", stderr: "not found" }) },
    ] }),
    row("response_item", { type: "custom_tool_call", name: "exec", call_id: "mixed", input: 'text(await tools.exec_command({cmd:"pwd"}));\ntext(ALL_TOOLS);' }),
    row("response_item", { type: "custom_tool_call_output", call_id: "mixed", output: [
      { type: "input_text", text: "Script completed" },
      { type: "input_text", text: JSON.stringify({ exit_code: 0, output: "/work", stderr: "" }) },
      { type: "input_text", text: "Extra JavaScript result" },
    ] }),
  ].join("\n");
  const records = codexTranscriptRecords(lines);
  expect(records[1]).toMatchObject({ parts: [{ type: "toolCall", name: "bash", args: { command: "ls -la /work" } }] });
  expect(records[2]).toMatchObject({ kind: "toolResult", text: "missing\nnot found", isError: true });
  expect(records[3]).toMatchObject({ parts: [
    { type: "toolCall", name: "bash", args: { command: "pwd" } },
    { type: "toolCall", name: "exec", args: { code: "text(ALL_TOOLS);" } },
  ] });
  expect(records[4]).toMatchObject({ kind: "toolResult", text: "/work" });
  expect(records[5]).toMatchObject({ kind: "toolResult", text: "Extra JavaScript result" });
});

test("loads only the tab-local Codex rollout and serves embedded user images", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-transcript-"));
  const previous = process.env.ATELIER_DATA_DIR;
  process.env.ATELIER_DATA_DIR = root;
  try {
    const dir = join(root, "workspaces/workspace/home-local/.local/share/atelier-agents/tab/codex/sessions/2026/01/01");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "rollout.jsonl"), row("response_item", { type: "message", id: "image-id", role: "user", content: [{ type: "input_text", text: "Look" }, { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" }] }));
    expect(await loadCodexTranscript("workspace", "tab")).toMatchObject([{ kind: "user", images: [{ entryId: "image-id", contentIndex: 1, mimeType: "image/png" }] }]);
    await writeFile(join(dir, "rollout.jsonl"), row("session_meta", { id: "exact-native-id" }));
    expect(await codexResumeId("workspace", "tab")).toBe("exact-native-id");
    expect(await codexResumeId("workspace", "other-tab")).toBeUndefined();
    await writeFile(join(dir, "rollout.jsonl"), row("response_item", { type: "message", id: "image-id", role: "user", content: [{ type: "input_text", text: "Look" }, { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" }] }));
    await expect(codexResumeId("workspace", "tab")).rejects.toThrow("no native session ID");
    const response = await loadCodexTranscriptImage("workspace", "tab", "image-id", 1);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello");
    expect(await loadCodexTranscript("workspace", "other-tab")).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.ATELIER_DATA_DIR;
    else process.env.ATELIER_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
