import { expect, test } from "bun:test";
import { join } from "node:path";

test("Codex receives full native developer instructions alongside session-private MCP configuration", async () => {
  const source = join(import.meta.dir, "../src/server/session.ts");
  const child = Bun.spawn([process.execPath, "-e", `
    import { expect, mock } from "bun:test";
    const workspace = await import("@agents-in-the-cloud/workspace");
    const calls = [];
    mock.module("@agents-in-the-cloud/workspace", () => ({ ...workspace, execWorkspaceShell: async (...args) => { calls.push(args); return { exitCode: 0, stdout: "", stderr: "", durationMs: 0 }; } }));
    const { prepareCodexSession } = await import(${JSON.stringify(source)});
    const mcp = { url: "http://127.0.0.1:2988/mcp", token: "private-bearer-token" };
    const session = { id: "session", directory: "/session", turnSignalCommand: "/session/signal.sh" };
    const instructions = 'Full guidance "quoted"\\n' + "x".repeat(12000);
    expect(await prepareCodexSession("workspace", session, { ...mcp, instructions })).toEqual({ CODEX_HOME: "/session/codex" });
    expect(calls).toHaveLength(1);
    const [, command, options] = calls[0];
    expect(command).toContain("umask 077");
    expect(command).toContain("/session/codex/config.toml");
    expect(command).not.toContain(mcp.token);
    expect(command).not.toContain(instructions);
    const config = Bun.TOML.parse(options.stdin);
    expect(config.developer_instructions).toBe(instructions);
    expect(config).not.toHaveProperty("model_instructions_file");
    expect(config).not.toHaveProperty("instructions");
    expect(config.mcp_servers["agents-in-the-cloud"]).toEqual({
      url: mcp.url, required: true, tool_timeout_sec: 3600, http_headers: { Authorization: "Bearer " + mcp.token },
    });
  `], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
});
