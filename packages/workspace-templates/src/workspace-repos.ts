import { type AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import { workspaceRepository } from "@agents-in-the-cloud/workspace/git";
import { inspectWorkspaceDeleteSafety } from "./deletion-safety.ts";
import { isGitWorkspaceTemplateInit, recordWorkspaceCreation } from "./workspace-template.ts";
import { registerGitIdentityWorkspaceEvents } from "./git-identity.ts";
import { registerWorkspaceTemplateWorkspaceInitEvents } from "./workspace-source.ts";

export function registerWorkspaceTemplateWorkspaceEvents(events: AgentsInTheCloudEventBus): void {
  registerWorkspaceTemplateWorkspaceInitEvents(events);
  registerGitIdentityWorkspaceEvents(events);
  events.on("workspace_created", async ({ init }) => {
    if (isGitWorkspaceTemplateInit(init)) await recordWorkspaceCreation(init.projectId);
  });
  events.on("workspace_delete_inspect", async ({ workspaceId, issues }) => { issues.push(...(await inspectWorkspaceDeleteSafety(path => workspaceRepository(workspaceId, path)))); });
}
