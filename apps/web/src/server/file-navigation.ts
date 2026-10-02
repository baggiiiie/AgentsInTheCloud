import { posix } from "node:path";
import { invalidArguments } from "@agents-in-the-cloud/core";
import { openFileInFiles } from "@agents-in-the-cloud/files/server";
import type { WorkspaceFileTarget, WorkspaceModuleRouteContext } from "@agents-in-the-cloud/shared";
import { listWorkspaceVSCodeViews, openFileInVSCode } from "@agents-in-the-cloud/vscode/server";
import { execWorkspaceCommand, workspaceRoot } from "@agents-in-the-cloud/workspace";

export async function openWorkspaceFile(workspaceId: string, target: WorkspaceFileTarget, openWorkView: WorkspaceModuleRouteContext["openWorkView"], requireExisting = false): Promise<Response> {
  const path = posix.resolve(workspaceRoot, target.path);
  if (path === workspaceRoot) throw invalidArguments("Choose a file to open");
  if (requireExisting) {
    // Plain terminal paths are only guesses; do not create a tab for an
    // example, nonexistent proposal, or directory.
    const result = await execWorkspaceCommand(workspaceId, ["sh", "-c", "test -f \"$1\" && test -r \"$1\"", "sh", path]);
    if (result.exitCode !== 0) return new Response(null, { status: 204 });
  }
  const resolvedTarget = { ...target, path };
  const vscode = listWorkspaceVSCodeViews(workspaceId)[0];
  return vscode
    ? openFileInVSCode(workspaceId, vscode.title, resolvedTarget, openWorkView)
    : openFileInFiles(workspaceId, resolvedTarget, openWorkView);
}
