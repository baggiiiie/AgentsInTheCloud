import { AgentsInTheCloudCoreError, collectUnpushedCommits, type UnpushedCommit, type JsonObject } from "@agents-in-the-cloud/core";
import { repositoryPaths, type Repository } from "@agents-in-the-cloud/workspace/git";

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
async function inspectRepositoryDeleteSafety(root: Repository, repoName: string): Promise<WorkspaceDeleteSafetyIssue | null> {
  const status = await root.gitResult(["status", "--porcelain=v1", "-z"]);
  if (status.exitCode !== 0) throw new AgentsInTheCloudCoreError("git_error", status.stderr.trim() || `could not check status for ${repoName}`);
  const unpushedCommits = await collectUnpushedCommits(args => root.gitResult(args));
  const issue = { repo: repoName, uncommittedPaths: parsePorcelainPaths(status.stdout.toString("utf8")), unpushedCommits };
  return issue.uncommittedPaths.length || issue.unpushedCommits.length ? issue : null;
}

export async function inspectWorkspaceDeleteSafety(repositoryFor: (relativePath: string) => Repository): Promise<WorkspaceDeleteSafetyIssue[]> {
  const repositories = await repositoryPaths(repositoryFor(""));
  const issues: WorkspaceDeleteSafetyIssue[] = [];
  for (const repository of repositories) {
    const issue = await inspectRepositoryDeleteSafety(repositoryFor(repository), repository || "work");
    if (issue) issues.push(issue);
  }
  return issues;
}

