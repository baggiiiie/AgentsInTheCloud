import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { resolveWorkspace, workspaceContainerName, workspaceRoot } from "@agents-in-the-cloud/workspace";
import type { CodexNotification } from "./protocol.ts";
import { CodexRpc } from "./rpc.ts";
import { codexVersion } from "./protocol.ts";

/** Stdio stays private: no listening port or raw provider credential in a workspace. */
export async function openCodexTransport(workspaceId: string, home: string, notification: (notification: CodexNotification) => void, failed: (error: Error) => void) {
  await resolveWorkspace(workspaceId);
  const executable = `/home/agents-in-the-cloud/.codex-cli/${codexVersion}/node_modules/.bin/codex`;
  const process = Bun.spawn(["docker", "exec", "-i", "--user", "agents-in-the-cloud", "--workdir", workspaceRoot, "--env", `CODEX_HOME=${home}`, workspaceContainerName(workspaceId), executable, "app-server", "--listen", "stdio://"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  let closing: Promise<void> | undefined;
  const rpc = new CodexRpc(line => { process.stdin.write(line); process.stdin.flush(); }, notification);
  let stderr = "";
  const stderrDecoder = new TextDecoder();
  const stderrDrain = (async () => {
    for await (const chunk of process.stderr) {
      stderr = (stderr + stderrDecoder.decode(chunk, { stream: true })).slice(-16000);
    }
    stderr = (stderr + stderrDecoder.decode()).slice(-16000);
  })();
  const lines = createInterface({ input: Readable.from(process.stdout), crlfDelay: Infinity });
  const reading = (async () => {
    try { for await (const line of lines) if (line.trim()) rpc.receive(line); }
    catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      rpc.fail(failure);
      if (!closing) failed(failure);
      process.stdin.end();
    }
  })();
  void process.exited.then(async code => {
    await stderrDrain;
    const error = new Error(`Codex app-server exited (${code})${stderr ? `: ${stderr}` : ""}`);
    rpc.fail(error);
    if (!closing) failed(error);
  });
  return { rpc, close() {
    return closing ??= (async () => {
      rpc.fail(new Error("Codex connection closed"));
      process.stdin.end();
      await process.exited;
      await reading;
      await stderrDrain;
    })();
  } };
}
