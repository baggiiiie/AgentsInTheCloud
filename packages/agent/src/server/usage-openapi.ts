import type { JsonObject } from "@agents-in-the-cloud/core";
import { supportedUsageProviders } from "@agents-in-the-cloud/llm/server";

const errorResponse = { description: "Request failed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
const htmlSurfaceResponses = (description: string) => ({ "200": { description, content: { "text/html": { schema: { type: "string" } } } }, "400": errorResponse, "404": errorResponse });
const jsonAndHtmlResponse = (description: string, schema: JsonObject) => ({
  ...htmlSurfaceResponses(description),
  "200": { description, content: { "application/json": { schema }, "text/html": { schema: { type: "string" } } } },
});

const reportedUsageWindowSchema = {
  type: "object",
  properties: {
    limitName: { type: "string" }, meteredFeature: { type: ["string", "null"] }, kind: { enum: ["primary", "secondary"] },
    usedPercent: { type: "number" }, durationSeconds: { type: "integer" }, resetsAt: { type: ["string", "null"], format: "date-time", description: "Null when the provider has not reported reset timing; usage is still reported." },
  },
};
const providerUsageSchema = {
  type: "object",
  properties: {
    provider: { type: "object", properties: { id: { type: "string" }, label: { type: "string" } } }, connected: { type: "boolean" }, error: { type: ["string", "null"] },
    reported: { type: ["object", "null"], properties: {
      plan: { type: ["string", "null"], description: "Null when the provider does not report the subscription plan." }, checkedAt: { type: "string", format: "date-time" }, allowed: { type: ["boolean", "null"] }, limitReached: { type: ["boolean", "null"] },
      credits: { type: "object", properties: { unlimited: { type: "boolean" }, balance: { type: ["string", "null"], description: "Provider-reported units, not dollars." } } },
      resets: { type: "object", properties: { available: { type: "integer", minimum: 0 } } },
      windows: { type: "array", items: reportedUsageWindowSchema },
    } },
    windows: { type: "array", items: { type: "object", properties: {
      reported: reportedUsageWindowSchema,
      timing: { type: "object", description: "Linear pacing reference at reported.checkedAt. Start is inferred from reset minus duration, not explicitly reported by the provider. When reset timing is unknown, state is unknown and all timing values are null.", properties: {
        startsAt: { type: ["string", "null"], format: "date-time" }, elapsedPercent: { type: ["number", "null"], minimum: 0, maximum: 100 },
        paceDifferenceSeconds: { type: ["number", "null"], description: "Signed distance along the linear allowance schedule: paceDifferencePoints / 100 × durationSeconds. Positive means usage is ahead of pace; negative means behind. Not a forecast. Null outside an active window." },
        state: { enum: ["unknown", "not-started", "active", "reset-due"] }, paceDifferencePoints: { type: ["number", "null"], description: "Usage minus elapsed-time percentage, in percentage points. Positive is above linear pace. Null outside an active window." },
      } },
    } } },
  },
};

const refreshParameter = { name: "refresh", in: "query", required: false, schema: { type: "string" }, description: "When present, ask providers now instead of reusing what AgentsInTheCloud already knows." } satisfies JsonObject;

export const usageOpenApiPaths = {
  "/usage": { get: {
    summary: "Open Usage or inspect all connected, supported providers",
    parameters: [refreshParameter],
    description: "HTML opens the Usage dialog in the AgentsInTheCloud shell. JSON includes provider-reported subscription windows and pacing. Supports OpenAI Codex and Anthropic subscriptions. Anthropic requires OAuth sign-in, not an API key; its main limits come from Claude Code responses through the workspace proxy. AgentsInTheCloud asks Anthropic with a one-token message to its cheapest model only on the first read after start or a credential change, after a window resets, and on refresh. Provider failures are explicit per-provider errors.",
    responses: jsonAndHtmlResponse("Usage overview", { type: "object", properties: { providers: { type: "array", items: providerUsageSchema } } }),
  } },
  "/usage/button": { get: { summary: "Usage button perimeter for the most urgent recently used subscription", responses: htmlSurfaceResponses("Server-rendered button frame. Among subscriptions used in the 30 minutes ending at the last recorded inference, shows the active allowance projected to reach 100% soonest before its next reset, at its average consumption rate since the window began. Projections stop at the next reset; limits that will not fill before then have infinite runway. Ties prefer higher usage. Green is Time beyond Usage; red is Usage beyond Time. No ring without recorded activity or an active reported limit.") } },
  "/usage/overview": { get: { summary: "Refresh the server-rendered Usage overview frame", parameters: [refreshParameter], responses: htmlSurfaceResponses("Usage overview frame") } },
  "/usage/providers/{provider}": { get: {
    summary: "Refresh subscription limits for a provider",
    parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string", enum: supportedUsageProviders.map((provider) => provider.id) } }, refreshParameter],
    responses: jsonAndHtmlResponse("Provider usage, including any provider error", providerUsageSchema),
  } },
} satisfies Record<string, JsonObject>;
