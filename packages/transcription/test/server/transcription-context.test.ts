import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addTranscriptionContext, readTranscriptionContext } from "../../src/server/transcription-context.ts";

let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

test("reads one phrase per line, ignoring comments and blank lines", async () => {
  root = await mkdtemp(join(tmpdir(), "transcription-context-"));
  expect(await readTranscriptionContext(root)).toEqual([]);
  await mkdir(join(root, ".agents-in-the-cloud"));
  await writeFile(join(root, ".agents-in-the-cloud", "transcription-context"), "# Terms\r\nClaude Code # product\r\n\r\n  Nemotron  \r\n");
  expect(await readTranscriptionContext(root)).toEqual(["Claude Code", "Nemotron"]);
});

test("adds the words to the realtime session update without changing other messages", () => {
  const message = JSON.stringify({ type: "session.update", session: { sample_rate: 48000, language: "auto" } });
  expect(JSON.parse(addTranscriptionContext(message, ["Claude Code", "AgentsInTheCloud"]))).toEqual({
    type: "session.update", session: { sample_rate: 48000, language: "auto", speech_contexts: [{ phrases: ["Claude Code", "AgentsInTheCloud"], boost: 3 }] },
  });
  expect(addTranscriptionContext(message, [])).toBe(message);
  const commit = JSON.stringify({ type: "input_audio_buffer.commit" });
  expect(addTranscriptionContext(commit, ["AgentsInTheCloud"])).toBe(commit);
});
