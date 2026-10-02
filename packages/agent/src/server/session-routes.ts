import { stopDurableWorkspaceAgentConversation } from "./runtime.ts";
import { existingDurableController } from "./runtime.ts";
import { AtelierCoreError, requestAcceptsJson } from "@atelier/core";
import { turboStreamResponse } from "@atelier/shared";
import { invalidateAgentView, matchRoute, requireAgentPresentation, requireAgentController, type AgentRouteHandler } from "./route-support.ts";
import { resolveAgentConversation } from "./delegation.ts";
import { handleAgentTreeRequest } from "./session-tree.ts";

export const handleSessionRequest: AgentRouteHandler = async (request, url, options) => {
  let params: string[] | undefined;
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/reveal\/([^/]+)$/)) && request.method === "GET") {
    const [workspaceId, conversationId, target] = params;
    const runtime = await requireAgentPresentation(workspaceId, conversationId, options);
    return Response.json({ turnId: runtime.revealTurn(target) ?? null });
  }
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/transcript-items\/([^/]+)$/)) && request.method === "GET") {
    const runtime = await requireAgentPresentation(params[0], params[1], options);
    const count = Math.max(100, Math.min(100_000, Number(url.searchParams.get("count") ?? 100) || 100));
    const html = await runtime.detailHtml(params[2], count);
    return new Response(html || "not found", { status: html ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/session-images\/([^/]+)\/(\d+)$/)) && request.method === "GET") {
    const agent = await resolveAgentConversation(params[0], params[1], options.events);
    const controller = await existingDurableController(agent, options);
    return controller ? await controller.image(params[2], Number(params[3])) : new Response("not found", { status: 404 });
  }
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/tree(\/summary|\/label|)$/))) {
    const [workspaceId, conversationId, suffix] = params;
    const response = await handleAgentTreeRequest(request, url, suffix, async () => await requireAgentPresentation(workspaceId, conversationId, options), async () => await requireAgentController(workspaceId, conversationId, options));
    if (response && request.method === "POST") await invalidateAgentView(options, workspaceId, conversationId);
    return response;
  }
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/abort$/)) && request.method === "POST") {
    const agent = await resolveAgentConversation(params[0], params[1], options.events);
    await stopDurableWorkspaceAgentConversation(agent, options);
    await invalidateAgentView(options, params[0], params[1]);
    return requestAcceptsJson(request) ? Response.json({ agent: { conversationId: params[1], state: "idle", aborted: true } }) : turboStreamResponse("");
  }
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/rewind$/)) && request.method === "POST") {
    const form = await request.formData();
    const entry = String(form.get("entry") ?? "");
    const mode = String(form.get("rewindMode") ?? "discard") === "summary" ? "summary" : "discard";
    if (mode === "summary") throw new AtelierCoreError("invalid_arguments", "Continue without a summary for this history.");
    const controller = await requireAgentController(params[0], params[1], options);
    if (entry) {
      await controller.navigate(entry, true);
      await invalidateAgentView(options, params[0], params[1]);
    }
    return turboStreamResponse("");
  }
  return undefined;
};
