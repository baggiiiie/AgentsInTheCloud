import { copyJson } from "@earendil-works/chord";
import { createReadTool, createWriteTool, createEditTool } from "@earendil-works/pi-coding-agent";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
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

/** File/image and presentation capabilities ready for the native Durable registry. */
export function createDurableWorkspaceTools(workspaceId: string, options: WorkspaceAgentToolOptions = {}): ToolRegistration<any>[] {
  const operations = workspaceFileToolOptions(workspaceId);
  return [
    // Durable 1.0's built-in read rejects images. The SDK's context-free tool
    // preserves Atelier's existing image and text handling without AgentSession.
    durableWorkspaceTool(createReadTool(workspaceRoot, operations.read), "safe"),
    durableWorkspaceTool(createWriteTool(workspaceRoot, operations.write)),
    durableWorkspaceTool(createEditTool(workspaceRoot, operations.edit)),
    ...createAtelierControlTools(workspaceId, { ...options, embeds: true }).map((tool) => durableWorkspaceTool(tool)),
    // Do not adapt legacy bash: its abort signal kills work on host suspension.
    // Install createDurableBashExtension alongside these tools; it owns the
    // receipt-backed bash task as well as the tool registration.
  ];
}
