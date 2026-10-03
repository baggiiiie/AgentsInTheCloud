import { listFileCompletions, renderFileCompletionMenu } from "./file-completions.ts";
import { expandPromptTemplate } from "./prompt-templates.ts";
import { matchRoute, response, textResponse } from "@agents-in-the-cloud/shared/http";
import { type AgentRouteHandler } from "./route-support.ts";
import { resolveAgentConversation } from "./delegation.ts";

export const handleCompletionRequest: AgentRouteHandler = async (request, url) => {
  let params: string[] | undefined;
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/completions$/)) && request.method === "GET") {
    await resolveAgentConversation(params[0], params[1]);
    const query = url.searchParams.get("q") ?? "";
    const mode = url.searchParams.get("mode") === "fuzzy" ? "fuzzy" : "direct";
    return response(renderFileCompletionMenu(await listFileCompletions(params[0], query, mode)));
  }
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/completions\/prompt-template-expand$/)) && request.method === "POST") {
    await resolveAgentConversation(params[0], params[1]);
    const form = await request.formData();
    const expanded = await expandPromptTemplate(params[0], String(form.get("text") ?? ""));
    return textResponse(expanded);
  }
  return undefined;
};
