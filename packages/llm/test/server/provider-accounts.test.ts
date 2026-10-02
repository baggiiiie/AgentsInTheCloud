import { expect, test } from "bun:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { cachedAccountSummaries, codexAccountSummary, fetchAnthropicAccountSummary, fetchOpenAIAccountSummary, fetchRadiusAccountSummary, fetchXaiAccountSummary, providerAccountSummary } from "../../src/server/provider-accounts.ts";

function jwt(claims: Record<string, Record<string, string | boolean>>): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}

function profile(organizationType: string, organizationName = "someone@example.com's Organization") {
  return { account: { email: "someone@example.com", display_name: "Someone" }, organization: { name: organizationName, organization_type: organizationType } };
}

test("ChatGPT accounts show the email and plan from the access token", () => {
  expect(codexAccountSummary(jwt({
    "https://api.openai.com/profile": { email: "someone@example.com", email_verified: true },
    "https://api.openai.com/auth": { chatgpt_account_id: "account", chatgpt_plan_type: "pro" },
  }))).toBe("someone@example.com · Pro");
});

test("ChatGPT tokens without a profile email are rejected", () => {
  expect(() => codexAccountSummary(jwt({ "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } }))).toThrow();
});

test("personal Claude accounts show the email and plan", async () => {
  const summary = await fetchAnthropicAccountSummary("token", async (url, init) => {
    expect(url).toBe("https://api.anthropic.com/api/oauth/profile");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
    return Response.json(profile("claude_max"));
  });
  expect(summary).toBe("someone@example.com · Max");
});

test("shared Claude organizations add the organization name", async () => {
  expect(await fetchAnthropicAccountSummary("token", async () => Response.json(profile("claude_team", "Acme")))).toBe("someone@example.com · Team · Acme");
});

test("xAI accounts show the email from userinfo", async () => {
  expect(await fetchXaiAccountSummary("token", async (url, init) => {
    expect(url).toBe("https://auth.x.ai/oauth2/userinfo");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
    return Response.json({ sub: "user", name: "Someone", email: "someone@example.com", email_verified: true });
  })).toBe("someone@example.com");
});

test("OpenAI accounts show the email from the user endpoint", async () => {
  expect(await fetchOpenAIAccountSummary("token", async (url, init) => {
    expect(url).toBe("https://api.openai.com/v1/me");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
    return Response.json({ id: "user", object: "user", email: "someone@example.com", name: "Someone" });
  })).toBe("someone@example.com");
});

test("Radius accounts show the organization", async () => {
  expect(await fetchRadiusAccountSummary("token", async (url) => {
    expect(url).toBe("https://radius.pi.dev/v1/context");
    return Response.json({ ok: true, actor: { principal_id: "p", principal_kind: "user" }, organization: { id: "o", name: "Acme", slug: null, role: "owner" }, scopes: [] });
  })).toBe("Acme");
});

test("one profile lookup serves an access token until it rotates", async () => {
  let requests = 0;
  const summary = cachedAccountSummaries((token) => fetchAnthropicAccountSummary(token, async () => { requests++; return Response.json(profile("claude_pro")); }));
  await summary("first");
  expect(await summary("first")).toBe("someone@example.com · Pro");
  expect(requests).toBe(1);
  await summary("rotated");
  expect(requests).toBe(2);
});

test("failed profile lookups retry after a minute", async () => {
  let time = 0;
  let status = 429;
  const summary = cachedAccountSummaries((token) => fetchAnthropicAccountSummary(token, async () => status === 200 ? Response.json(profile("claude_pro")) : new Response("", { status })), () => time);
  expect(await summary("token")).toBeUndefined();
  status = 200;
  expect(await summary("token")).toBeUndefined();
  time = 60_000;
  expect(await summary("token")).toBe("someone@example.com · Pro");
});

function runtime(status: ReturnType<ModelRuntime["getProviderAuthStatus"]>, type: "oauth" | "api_key", providerId = "openai") {
  return {
    getProviderAuthStatus: () => status,
    listCredentials: async () => [{ providerId, type }],
    getAuth: async () => { throw new Error("must not resolve"); },
  };
}

test("stored API keys are summarized without resolving them", async () => {
  expect(await providerAccountSummary(runtime({ configured: true, source: "stored" }, "api_key"), "openai")).toBe("API key");
});

test("environment keys name their variable", async () => {
  expect(await providerAccountSummary(runtime({ configured: true, source: "environment", label: "OPENAI_API_KEY" }, "api_key"), "openai")).toBe("From OPENAI_API_KEY");
});

test("other subscriptions are summarized without resolving them", async () => {
  expect(await providerAccountSummary(runtime({ configured: true, source: "stored" }, "oauth", "github-copilot"), "github-copilot")).toBe("Subscription");
});
