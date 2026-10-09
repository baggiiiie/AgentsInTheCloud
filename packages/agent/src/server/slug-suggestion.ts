import { resolveNewWorkspaceAgentModel } from "./model-state.ts";
import { cheapestAvailableProviderModel, claudeCodeHeaders, createPiModelRuntime, type ModelRef } from "@agents-in-the-cloud/llm/server";
export const agentTitleRequestOptions = { maxTokens: 64 } as const;

export function promptFor(userPrompt: string): string {
  return `Name this Agent based on its task using 2–7 meaningful lowercase words joined by hyphens. Return ONLY the slug: no explanation, reasoning, quotes, or punctuation. If the prompt does not identify a task, return exactly error.

User's task:
--
${userPrompt}
--`;
}

export function textFromResponse(response: { content: Array<{ type: string; text?: string }> }): string {
  return response.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

export function normalizeSlug(value: string): string | undefined {
  const firstLine = value.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const withoutQuotes = firstLine.replace(/^`+|`+$/g, "").replace(/^["']|["']$/g, "").trim();
  if (!withoutQuotes || withoutQuotes.toLowerCase() === "error") return undefined;
  const slug = withoutQuotes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || undefined;
}

export async function suggestAgentSlug(userPrompt: string, selectedModel?: ModelRef): Promise<string | undefined> {
  if (!userPrompt.trim()) return undefined;
  const modelRef = selectedModel ?? await resolveNewWorkspaceAgentModel();
  if (!modelRef) return undefined;
  const runtime = await createPiModelRuntime();
  const model = await cheapestAvailableProviderModel(runtime, modelRef.provider);
  if (!model || !(await runtime.checkAuth(model.provider))) return undefined;
  const response = await runtime.completeSimple(model, {
    messages: [{ role: "user", content: promptFor(userPrompt), timestamp: Date.now() }],
  }, { ...agentTitleRequestOptions, headers: claudeCodeHeaders(model), sessionId: crypto.randomUUID() });
  if (response.stopReason === "error") return undefined;
  return normalizeSlug(textFromResponse(response));
}
