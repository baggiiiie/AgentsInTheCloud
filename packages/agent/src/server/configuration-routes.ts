import { AgentsInTheCloudCoreError, readJsonObject, requestAcceptsJson } from "@agents-in-the-cloud/core";
import { turboStreamResponse } from "@agents-in-the-cloud/shared";
import { parseModelRef, setAgentModelThinkingLevel } from "@agents-in-the-cloud/llm/server";
import { invalidateAgentView, matchRoute, requireAgentController, type AgentRouteHandler } from "./route-support.ts";

export const handleConfigurationRequest: AgentRouteHandler = async (request, url, options) => {
  let params: string[] | undefined;
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/model$/)) && request.method === "POST") {
    const json = requestAcceptsJson(request);
    const value = json ? (await readJsonObject(request)).model : (await request.formData()).get("model");
    const model = parseModelRef(String(value ?? ""));
    if (!model) {
      if (json) throw new AgentsInTheCloudCoreError("invalid_arguments", "valid model is required");
      return turboStreamResponse("");
    }
    const runtime = await requireAgentController(params[0], params[1], options);
    await runtime.configure({ model: { provider: model.provider, modelId: model.id } });
    await invalidateAgentView(options, params[0], params[1]);
    return json ? Response.json({ agent: { conversationId: params[1], model: `${model.provider}::${model.id}` } }) : turboStreamResponse("");
  }
  if ((params = matchRoute(url, /^\/workspaces\/([^/]+)\/agents\/([^/]+)\/thinking$/)) && request.method === "POST") {
    const json = requestAcceptsJson(request);
    const value = json ? (await readJsonObject(request)).level : (await request.formData()).get("level");
    const level = String(value ?? "");
    if (!level) {
      if (json) throw new AgentsInTheCloudCoreError("invalid_arguments", "level is required");
      return turboStreamResponse("");
    }
    const runtime = await requireAgentController(params[0], params[1], options);
    await runtime.configure({ thinkingLevel: level });
    const model = (await runtime.settings()).model;
    if (model) await setAgentModelThinkingLevel("builtin", { provider: model.provider, id: model.modelId }, level);
    await invalidateAgentView(options, params[0], params[1]);
    return json ? Response.json({ agent: { conversationId: params[1], thinkingLevel: level } }) : turboStreamResponse("");
  }
  return undefined;
};
