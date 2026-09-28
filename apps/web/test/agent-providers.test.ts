import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAtelierEventBus } from "@atelier/core";
import { agentProvider, defaultAgentProvider, orderedAgentProviders, rememberAgentProvider } from "../src/server/agent-providers.ts";

let directory: string;
let previous: string | undefined;
beforeEach(async () => {
  previous = process.env.ATELIER_DATA_DIR;
  directory = await mkdtemp(join(tmpdir(), "atelier-agent-providers-"));
  process.env.ATELIER_DATA_DIR = directory;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.ATELIER_DATA_DIR;
  else process.env.ATELIER_DATA_DIR = previous;
  await rm(directory, { recursive: true, force: true });
});

test("builtin is the initial default and successful choices persist", async () => {
  expect((await defaultAgentProvider()).id).toBe("builtin");
  await rememberAgentProvider("codex");
  expect(JSON.parse(await Bun.file(join(directory, "default-agent-provider.json")).text())).toBe("codex");
  expect((await orderedAgentProviders()).map(({ id }) => id)).toEqual(["codex", "builtin", "claude", "pi"]);
  await rememberAgentProvider("claude");
  expect((await defaultAgentProvider()).id).toBe("claude");
  expect((await orderedAgentProviders()).map(({ id }) => id)).toEqual(["claude", "builtin", "codex", "pi"]);
  await rememberAgentProvider("pi");
  expect((await defaultAgentProvider()).id).toBe("pi");
  expect((await orderedAgentProviders()).map(({ id }) => id)).toEqual(["pi", "builtin", "claude", "codex"]);
  await rememberAgentProvider("builtin");
  expect((await defaultAgentProvider()).id).toBe("builtin");
});

test("an unavailable saved default resolves to builtin without rewriting the saved preference", async () => {
  await writeFile(join(directory, "default-agent-provider.json"), JSON.stringify("uninstalled"));
  expect((await defaultAgentProvider()).id).toBe("builtin");
  expect(JSON.parse(await Bun.file(join(directory, "default-agent-provider.json")).text())).toBe("uninstalled");
});

test("unknown providers cannot overwrite the default", async () => {
  await rememberAgentProvider("codex");
  expect(() => agentProvider("unknown")).toThrow("Unknown agent provider");
  await expect(rememberAgentProvider("unknown")).rejects.toMatchObject({ code: "invalid_arguments" });
  expect((await defaultAgentProvider()).id).toBe("codex");
});

test("default-change events observe the already-persisted preference", async () => {
  const events = createAtelierEventBus();
  const observed: string[] = [];
  events.on("agent_provider_default_changed", async ({ providerId }) => {
    expect((await defaultAgentProvider()).id).toBe(providerId);
    observed.push(providerId);
  });
  await rememberAgentProvider("codex", events);
  expect(observed).toEqual(["codex"]);
});

test("defaults to Claude Code when an Anthropic subscription is the only way to run an agent", async () => {
  const child = Bun.spawn([process.execPath, "-e", `
    import { expect, mock } from "bun:test";
    const agent = await import("@atelier/agent/server");
    const llm = await import("@atelier/llm/server");
    let builtinHasModel = false;
    let credentials = [{ providerId: "anthropic", type: "oauth" }];
    mock.module("@atelier/agent/server", () => ({ ...agent, hasAvailableBuiltinAgentModel: async () => builtinHasModel }));
    mock.module("@atelier/llm/server", () => ({ ...llm, createPiModelRuntime: async () => ({ listCredentials: async () => credentials }) }));
    const { defaultAgentProvider, orderedAgentProviders, rememberAgentProvider } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/agent-providers.ts"))});
    expect((await orderedAgentProviders())[0].id).toBe("claude");
    await rememberAgentProvider("builtin");
    expect((await defaultAgentProvider()).id).toBe("claude");
    await rememberAgentProvider("codex");
    expect((await defaultAgentProvider()).id).toBe("codex");
    await rememberAgentProvider("builtin");
    builtinHasModel = true;
    expect((await defaultAgentProvider()).id).toBe("builtin");
    builtinHasModel = false;
    credentials = [{ providerId: "anthropic", type: "api_key" }];
    expect((await defaultAgentProvider()).id).toBe("builtin");
  `], { cwd: join(import.meta.dir, ".."), env: { ...process.env, ATELIER_DATA_DIR: directory }, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
});
