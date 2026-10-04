import { AgentsInTheCloudCoreError, collectUnpushedCommits, shellQuote, type UnpushedCommit, type AgentsInTheCloudEventBus, type JsonObject } from "@agents-in-the-cloud/core";
import { execWorkspaceShell, workspaceRoot } from "@agents-in-the-cloud/workspace";
import { isGitWorkspaceTemplateInit, recordWorkspaceCreation } from "./workspace-template.ts";
import { registerGitIdentityWorkspaceEvents } from "./git-identity.ts";
import { registerWorkspaceTemplateWorkspaceInitEvents } from "./workspace-source.ts";

interface WorkspaceDeleteSafetyIssue extends JsonObject { repo: string; uncommittedPaths: string[]; unpushedCommits: UnpushedCommit[] }

function parsePorcelainPaths(output: string): string[] {
  const paths: string[] = [];
  const records = output.split("\0").filter(Boolean);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    paths.push(record.slice(3));
    if (indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") index += 1;
  }
  return paths;
}
async function inspectRepositoryDeleteSafety(id: string, path: string, repoName: string): Promise<WorkspaceDeleteSafetyIssue | null> {
  const quotedPath = shellQuote(path);
  const status = await execWorkspaceShell(id, `git -C ${quotedPath} status --porcelain=v1 -z`);
  if (status.exitCode !== 0) throw new AgentsInTheCloudCoreError("git_error", status.stderr.trim() || `could not check status for ${repoName}`);
  const unpushedCommits = await collectUnpushedCommits((args) => execWorkspaceShell(id, `git -C ${quotedPath} ${args.map(shellQuote).join(" ")}`));
  const issue = { repo: repoName, uncommittedPaths: parsePorcelainPaths(status.stdout), unpushedCommits };
  return issue.uncommittedPaths.length || issue.unpushedCommits.length ? issue : null;
}

async function inspectWorkspaceDeleteSafety(id: string): Promise<WorkspaceDeleteSafetyIssue[]> {
  const quotedRoot = shellQuote(workspaceRoot);
  const repo = await execWorkspaceShell(id, `git -C ${quotedRoot} rev-parse --is-inside-work-tree >/dev/null 2>&1`);
  if (repo.exitCode !== 0) return [];

  const submodules = await execWorkspaceShell(id, `git -C ${quotedRoot} submodule foreach --quiet --recursive 'printf "%s\\0" "$displaypath"'`);
  if (submodules.exitCode !== 0) throw new AgentsInTheCloudCoreError("git_error", submodules.stderr.trim() || "could not enumerate workspace submodules");
  const repositories = [
    { path: workspaceRoot, name: "work" },
    ...submodules.stdout.split("\0").filter(Boolean).map((path) => ({ path: `${workspaceRoot}/${path}`, name: path })),
  ];
  const issues: WorkspaceDeleteSafetyIssue[] = [];
  for (const repository of repositories) {
    const issue = await inspectRepositoryDeleteSafety(id, repository.path, repository.name);
    if (issue) issues.push(issue);
  }
  return issues;
}

export function registerWorkspaceTemplateWorkspaceEvents(events: AgentsInTheCloudEventBus): void {
  registerWorkspaceTemplateWorkspaceInitEvents(events);
  registerGitIdentityWorkspaceEvents(events);
  events.on("workspace_created", async ({ init }) => {
    if (isGitWorkspaceTemplateInit(init)) await recordWorkspaceCreation(init.projectId);
  });
  events.on("workspace_delete_inspect", async ({ workspaceId, issues }) => { issues.push(...(await inspectWorkspaceDeleteSafety(workspaceId))); });
}
