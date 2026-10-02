import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellQuote } from "@agents-in-the-cloud/core";
import { piLaunchScript } from "../src/server/launch-command.ts";
import { piAgentsInTheCloudExtensionPath } from "../src/server/mcp.ts";

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "pi-launch-")); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });
const binary = () => `${home}/.local/bin/pi`;
async function executable(path: string, script: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `#!/bin/bash\n${script}`);
  await chmod(path, 0o755);
}
function run(script: string) {
  const child = Bun.spawn(["/bin/bash", "-c", script], { env: { ...process.env, HOME: home, PATH: `${home}/.local/bin:${home}/tools:/usr/bin:/bin` }, stdout: "pipe", stderr: "pipe" });
  return Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
}
const empty = { text: "", images: [], attachmentNotes: [] };
const sessionId = "1f2e3d4c-0000-4000-8000-000000000001";
const baseArgs = ["--approve", "--offline", "--use-theme", "agents-in-the-cloud", "--tui-mode", "regular", "--session-dir", "/home/agents-in-the-cloud/.local/share/pi/sessions"];

test("passes initial prompt, images, file notes, provider and Pi thinking level literally", async () => {
  await executable(binary(), 'printf "%s\\0" "$@"');
  const text = `--help 'quoted' $(touch ${home}/injected)\nsecond line`;
  const notes = "File: /tmp/agents-in-the-cloud-attachments/my file.txt";
  const image = "/tmp/agents-in-the-cloud-attachments/image 1.png";
  const [code, output] = await run(piLaunchScript({ ...empty, text, attachmentNotes: [notes] }, [image], { model: "anthropic::claude", thinkingLevel: "minimal" }));
  expect(code).toBe(0);
  expect(output.split("\0").slice(0, -1)).toEqual([...baseArgs, "--provider", "anthropic", "--model", "claude", "--thinking", "minimal", "--", `@${image}`, `${text}\n\n${notes}`]);
  expect(await Bun.file(`${home}/injected`).exists()).toBe(false);
});

test("@-prefixed messages are not interpreted as file arguments by Pi", async () => {
  await executable(binary(), 'printf "%s\\0" "$@"');
  const [code, output] = await run(piLaunchScript({ ...empty, text: "@someone inspect this" }, []));
  expect(code).toBe(0);
  expect(output.split("\0").slice(0, -1)).toEqual([...baseArgs, "--", "\n@someone inspect this"]);
});

test("empty launch stays interactive without submitting a prompt", async () => {
  await executable(binary(), 'printf "%s\\0" "$@"');
  const [code, output] = await run(piLaunchScript(empty, []));
  expect(code).toBe(0);
  expect(output.split("\0").slice(0, -1)).toEqual([...baseArgs, "--"]);
});

test("concurrent launches install latest once in shared home and both run", async () => {
  await executable(`${home}/tools/npm`, `printf '%s\\n' "$*" >> ${shellQuote(`${home}/installs`)}
sleep .1
mkdir -p "$3/node_modules/.bin"
printf '#!/bin/sh\\nprintf "PI_STARTED\\\\n"\\n' > "$3/node_modules/.bin/pi"
chmod +x "$3/node_modules/.bin/pi"`);
  const results = await Promise.all([run(piLaunchScript(empty, [])), run(piLaunchScript(empty, []))]);
  for (const [code, output] of results) { expect(code).toBe(0); expect(output).toContain("PI_STARTED"); }
  const installs = (await readFile(`${home}/installs`, "utf8")).trim().split("\n");
  expect(installs).toHaveLength(1);
  expect(installs[0]).toContain("@earendil-works/pi-coding-agent@latest");
  expect(await Bun.file(`${home}/.pi-cli/node_modules/.bin/pi`).exists()).toBe(true);
  expect(await Bun.file(binary()).exists()).toBe(true);
});

test("installation and startup failures keep their exit codes and diagnostics", async () => {
  await executable(`${home}/tools/npm`, "echo registry-unavailable >&2; exit 42");
  const [code, output, error] = await run(piLaunchScript(empty, []));
  expect(code).toBe(42);
  expect(error).toContain("registry-unavailable");
  expect(output).toContain("Pi failed (exit 42)");
  await executable(binary(), "echo invalid-configuration >&2; exit 7");
  const [startupCode, startupOutput, startupError] = await run(piLaunchScript(empty, []));
  expect(startupCode).toBe(7);
  expect(startupError).toContain("invalid-configuration");
  expect(startupOutput).toContain("Pi failed (exit 7)");
});

test("loads the session's AgentsInTheCloud extension", async () => {
  await executable(binary(), 'printf "%s\\0" "$@"');
  const session = { id: sessionId, directory: `${home}/session`, turnSignalCommand: `${home}/turn-signal.sh` };
  const [code, output] = await run(piLaunchScript(empty, [], {}, session));
  expect(code).toBe(0);
  expect(output.split("\0")).toContain(piAgentsInTheCloudExtensionPath(session));
  expect(output.split("\0")).toContain(`/home/agents-in-the-cloud/.local/share/pi/sessions/${sessionId}`);
});

test("installs an AgentsInTheCloud theme drawn from the terminal palette", async () => {
  await executable(binary(), 'printf "%s\\0" "$@"');
  const [code] = await run(piLaunchScript(empty, []));
  expect(code).toBe(0);
  const theme = JSON.parse(await readFile(`${home}/.pi/agent/themes/agents-in-the-cloud.json`, "utf8"));
  expect(theme.name).toBe("agents-in-the-cloud");
  expect(Object.keys(theme.colors).length).toBeGreaterThan(0);
  for (const color of Object.values(theme.colors)) expect(Number.isInteger(color) && Number(color) < 16).toBe(true);
});


test("native resume restores the exact conversation with no submitted prompt", async () => {
  await executable(binary(), 'printf "%s\\0" "$@"');
  const session = { id: sessionId, directory: `${home}/session`, turnSignalCommand: `${home}/turn-signal.sh` };
  const [code, output] = await run(piLaunchScript(empty, [], {}, session, "/home/agents-in-the-cloud/.local/share/pi/sessions/tab/saved.jsonl"));
  expect(code).toBe(0);
  const args = output.split("\0").slice(0, -1);
  expect(args.join(" ")).toContain(["--session", "/home/agents-in-the-cloud/.local/share/pi/sessions/tab/saved.jsonl"].join(" "));
  expect(args.at(-1)).toBe("--");
});
