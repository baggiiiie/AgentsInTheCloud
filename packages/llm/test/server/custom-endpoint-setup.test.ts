import { expect, test } from "bun:test";
import { customOpenAIDefaults, connectCustomOpenAIEndpoint, CustomEndpointInputError, type CustomOpenAIEndpointInput } from "../../src/server/custom-openai-endpoint.ts";

const input: CustomOpenAIEndpointInput = { api: "openai-completions", name: "DevBox Ollama", baseUrl: "https://models.example.com/v1/", apiKey: "stub-only-key", ...customOpenAIDefaults };

test("connection validates protocol, URL, name, model ID and limits before making requests", async () => {
  for (const baseUrl of ["not a URL", "ftp://model.example", "https://user:key@model.example/v1", "https://model.example/v1?key=secret", "https://model.example/v1#fragment"]) {
    await expect(connectCustomOpenAIEndpoint({ ...input, baseUrl }, true)).rejects.toBeInstanceOf(CustomEndpointInputError);
  }
  await expect(connectCustomOpenAIEndpoint({ ...input, maxTokens: 65536 }, true)).rejects.toThrow("Token limits");
  await expect(connectCustomOpenAIEndpoint({ ...input, contextWindow: 1.5 }, true)).rejects.toThrow("Token limits");
  await expect(connectCustomOpenAIEndpoint({ ...input, api: "other" }, true)).rejects.toThrow("Choose");
  await expect(connectCustomOpenAIEndpoint({ ...input, name: " " }, true)).rejects.toThrow("name");
  await expect(connectCustomOpenAIEndpoint(input, false)).rejects.toThrow("model ID");
});

test("failed discovery never follows redirects or reflects secret-bearing errors", async () => {
  let status = 302;
  let body = JSON.stringify({ error: input.apiKey });
  const paths: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    paths.push(new URL(request.url).pathname);
    expect(request.headers.get("authorization")).toBe(`Bearer ${input.apiKey}`);
    const headers = new Headers({ "content-type": "application/json" });
    if (status === 302) headers.set("location", "/leak");
    return new Response(body, { status, headers });
  } });
  const baseUrl = `http://127.0.0.1:${server.port}/v1`;
  try {
    await expect(connectCustomOpenAIEndpoint({ ...input, baseUrl }, true)).rejects.toThrow("HTTP 302");
    status = 401;
    await expect(connectCustomOpenAIEndpoint({ ...input, baseUrl }, true)).rejects.toThrow("HTTP 401");
    status = 200;
    for (const invalid of [{ data: [] }, { data: [{ id: 42 }] }, { data: [{ id: " " }] }, { models: ["coder"] }, { data: [{ id: input.apiKey }] }]) {
      body = JSON.stringify(invalid);
      const pending = connectCustomOpenAIEndpoint({ ...input, baseUrl }, true);
      await expect(pending).rejects.toBeInstanceOf(CustomEndpointInputError);
      await expect(pending).rejects.not.toThrow(input.apiKey);
    }
    expect(paths.every(path => path === "/v1/models")).toBe(true);
  } finally { server.stop(true); }
});

test("named endpoints share the existing provider store, discover both protocols and connect a manual model", async () => {
  const child = Bun.spawn([process.execPath, new URL("./fixtures/custom-endpoint-setup.ts", import.meta.url).pathname], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
