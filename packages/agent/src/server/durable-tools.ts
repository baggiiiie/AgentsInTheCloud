import { copyJson } from "@earendil-works/chord";
import { createReadTool, createWriteTool, createEditTool, type ReadToolOptions } from "@earendil-works/pi-coding-agent";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import type { Models } from "@earendil-works/pi-ai";
import { workspaceRoot } from "@atelier/workspace";
import type { TSchema } from "typebox";
import { createAtelierControlTools, type WorkspaceAgentToolOptions } from "./tools.ts";
import { workspaceFileToolOptions } from "./workspace-file-tools.ts";
import type { WorkspaceTool } from "./workspace-tool.ts";

/**
 * Adapt a context-free workspace capability, not an AgentSession extension.
 * Replay is opt-in at assembly, never inferred from a tool's name.
 */
export function durableWorkspaceTool<TParams extends TSchema>(
  tool: WorkspaceTool<TParams, unknown>,
  replay: "safe" | "unsafe" = "unsafe",
): ToolRegistration<TParams> {
  return defineTool({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    prepareArguments: tool.prepareArguments,
    executionMode: tool.executionMode,
    replay,
    async execute(args, api, context) {
      // SDK updates are snapshots, not append-only output. Store the snapshot in
      // details instead of duplicating every revision in the model transcript.
      let updates = Promise.resolve();
      const failures: unknown[] = [];
      try {
        const result = await tool.execute(api.callId, args, context.abortSignal, (partial) => {
          const snapshot = copyJson(partial, { omitUndefinedProperties: true });
          updates = updates.then(() => api.details(snapshot, context)).catch((error) => {
            // The SDK callback cannot await writes. Observe rejection now and
            // propagate it before returning the tool result, never fire-and-forget.
            failures.push(error);
          });
        });
        await updates;
        if (failures.length) throw failures[0];
        return {
          content: result.content,
          details: result.details === undefined ? undefined : copyJson(result.details, { omitUndefinedProperties: true }),
        };
      } finally {
        await updates;
      }
    },
  });
}

/** Resolve per invocation: one registry serves conversations with different models. */
export function createDurableReadTool(cwd: string, models: Pick<Models, "getModel">, options: ReadToolOptions = {}) {
  const read = durableWorkspaceTool(createReadTool(cwd, options), "safe");
  return defineTool({
    ...read,
    async execute(args, api, context) {
      const agent = await api.agent(context);
      const model = agent.model ? models.getModel(agent.model.provider, agent.model.modelId) : undefined;
      if (agent.model && !model) throw new Error(`Model not found: ${agent.model.provider}/${agent.model.modelId}`);
      const tool = durableWorkspaceTool(createReadTool(cwd, {
        ...options,
        resizeOptions: model?.inputLimits?.images?.resize ?? options.resizeOptions,
      }), "safe");
      const result = await tool.execute(args, api, context);
      if (model && !model.input.includes("image") && result.content?.some((part) => part.type === "image")) {
        // Retain the image in history for viewing and future vision models. Pi AI
        // omits it from non-vision requests; make that limitation model-visible.
        api.diagnostic({ severity: "info", code: "non_vision_model", message: "Current model does not support images. The image will be omitted from this request." });
      }
      return result;
    },
  });
}

/** File/image and presentation capabilities ready for the native Durable registry. */
export function createDurableWorkspaceTools(workspaceId: string, models: Pick<Models, "getModel">, options: WorkspaceAgentToolOptions = {}): ToolRegistration<any>[] {
  const operations = workspaceFileToolOptions(workspaceId);
  return [
    // Durable 1.0's built-in read rejects images. Use the SDK's context-free
    // executor with the calling conversation's resize profile, not AgentSession.
    createDurableReadTool(workspaceRoot, models, operations.read),
    durableWorkspaceTool(createWriteTool(workspaceRoot, operations.write)),
    durableWorkspaceTool(createEditTool(workspaceRoot, operations.edit)),
    ...createAtelierControlTools(workspaceId, { ...options, embeds: true }).map((tool) => durableWorkspaceTool(tool)),
    // Install createDurableBashExtension alongside these tools; it owns both
    // the receipt-backed bash task and its tool registration.
  ];
}
