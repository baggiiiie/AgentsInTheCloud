import { expect, test } from "bun:test";
import { join } from "node:path";

// Isolate catalogue mocks from the real provider registry used by the web tests.
async function scenario(script: string) {
  const child = Bun.spawn([process.execPath, "-e", `
    import { expect, mock } from "bun:test";
    const llm = await import("@atelier/llm/server");
    const favorites = [
      { provider: "anthropic", id: "claude", label: "Claude" },
      { provider: "openai", id: "first", label: "First" },
      { provider: "openai", id: "second", label: "Second" },
      { provider: "openai", id: "unavailable", label: "Unavailable" },
    ];
    mock.module("@atelier/llm/server", () => ({ ...llm,
      getConfiguredModels: async () => favorites,
      createPiModelRuntime: async () => ({ getAvailable: async () => favorites.slice(0, 3), checkAuth: async () => true, getProviderAuthStatus: () => ({ configured: true }), getModel: () => ({ thinkingLevelMap: { minimal: "low", off: "none" } }) }),
      modelThinkingLevels: async () => ["off", "minimal", "low", "medium", "high"],
    }));
    const { codexModelSettings: { prepare } } = await import(${JSON.stringify(join(import.meta.dir, "../src/server/model-settings.ts"))});
    ${script}
  `], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
}

test("defaults to the first available Codex favorite, never another provider", () => scenario(`
  expect(await prepare()).toEqual({ model: "openai::first", thinkingLevel: "medium" });
`));

test("accepts a chosen Codex favorite and supported thinking level", () => scenario(`
  expect(await prepare({ model: "openai::second", thinkingLevel: "high" })).toEqual({ model: "openai::second", thinkingLevel: "high" });
  expect((await prepare({ thinkingLevel: "none" })).thinkingLevel).toBe("none");
`));

test("rejects foreign, unavailable, non-favorite models and invalid thinking levels", () => scenario(`
  for (const model of ["anthropic::claude", "openai::unavailable", "openai::not-favorite", 42]) {
    await expect(prepare({ model })).rejects.toMatchObject({ code: "invalid_arguments" });
  }
  await expect(prepare({ thinkingLevel: "invented" })).rejects.toMatchObject({ code: "invalid_arguments" });
`));

test("offers native Codex efforts rather than Pi aliases", () => scenario(`
  expect((await prepare({ thinkingLevel: "low" })).thinkingLevel).toBe("low");
  await expect(prepare({ thinkingLevel: "minimal" })).rejects.toMatchObject({ code: "invalid_arguments" });
`));
