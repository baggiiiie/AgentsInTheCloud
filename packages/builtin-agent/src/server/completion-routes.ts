import { listFileCompletions, renderFileCompletionMenu } from "@agents-in-the-cloud/agent/server/file-completions";
import { expandPromptTemplate } from "@agents-in-the-cloud/agent/server/prompt-templates";
import { matchRoute, response, textResponse } from "@agents-in-the-cloud/shared/http";
import { type AgentRouteHandler } from "./route-support.ts";
import { resolveAgent } from "./delegation.ts";

export const handleCompletionRequest: AgentRouteHandler = async (request, url) => {
  let params: string[] | undefined;
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/completions$/)) && request.method === "GET") {
    await resolveAgent(params[0], params[1]);
    const query = url.searchParams.get("q") ?? "";
    const mode = url.searchParams.get("mode") === "fuzzy" ? "fuzzy" : "direct";
    return response(renderFileCompletionMenu(await listFileCompletions(params[0], query, mode)));
  }
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/completions\/prompt-template-expand$/)) && request.method === "POST") {
    await resolveAgent(params[0], params[1]);
    const form = await request.formData();
    const expanded = await expandPromptTemplate(params[0], String(form.get("text") ?? ""));
    return textResponse(expanded);
  }
  return undefined;
};
