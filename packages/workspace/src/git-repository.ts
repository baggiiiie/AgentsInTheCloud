import { join, relative, sep } from "node:path";
import { decodeRepositoryBatch, repositoryBatchRunner, type RepositoryRequest } from "./git-batch.ts";
import { workspaceRoot, type WorkspaceCommandOptions } from "./index.ts";

export interface GitResult { stdout: Buffer; stderr: string; exitCode: number }
export interface WorkingFile { contents: Buffer; mode: string }
export interface Repository {
  gitResult(args: string[]): Promise<GitResult>;
  workingFile(path: string): Promise<WorkingFile | undefined>;
  captureIndexTree(): Promise<Buffer>;
}

export function safeGitArguments(args: string[]): string[] {
  const command = args[0]!;
  const options = command === "diff" || command === "show" ? ["--no-ext-diff", "--no-textconv"] : [];
  return ["git", "--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "log.showSignature=false", "-c", "color.ui=false", command, ...options, ...args.slice(1)];
}

/** All repository-controlled execution and file reads stay in the workspace, as its regular user. */
export function createWorkspaceRepository(
  workspaceId: string,
  path: string,
  execute: (workspaceId: string, command: string[], options: WorkspaceCommandOptions) => Promise<GitResult>,
): Repository {
  if (path.startsWith("/")) throw new Error("Repository path must be workspace-relative");
  const workdir = join(workspaceRoot, path);
  const within = relative(workspaceRoot, workdir);
  if (within === ".." || within.startsWith(`..${sep}`)) throw new Error("Repository path escapes workspace");
  // A finite batch per await wave, not a worker: independent requests issued together
  // share one workspace exec. Dependent requests start the next batch.
  let pending: { request: RepositoryRequest; resolve: (result: GitResult) => void; reject: (error: Error) => void }[] = [];
  async function flush() {
    const batch = pending;
    pending = [];
    try {
      // Avoid runner startup for operations such as a single history page.
      if (batch.length === 1 && batch[0]!.request.kind === "git") {
        const result = await execute(workspaceId, safeGitArguments(batch[0]!.request.args), { workdir, user: "agents-in-the-cloud" });
        batch[0]!.resolve(result);
        return;
      }
      const requests = batch.map(({ request }) => request.kind === "git" ? { ...request, args: safeGitArguments(request.args) }
        : request.kind === "index-tree" ? { ...request, args: safeGitArguments(["rev-parse", "--git-path", "index"]), writeArgs: safeGitArguments(["write-tree"]) } : request);
      const result = await execute(workspaceId, ["bun", "--no-env-file", "--config=/dev/null", "--eval", repositoryBatchRunner], { workdir, user: "agents-in-the-cloud", stdin: JSON.stringify(requests) });
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Workspace repository batch failed");
      const results = decodeRepositoryBatch(result.stdout, batch.length);
      batch.forEach((request, index) => request.resolve(results[index]!));
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      batch.forEach(request => request.reject(failure));
    }
  }
  function enqueue(request: RepositoryRequest): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      pending.push({ request, resolve, reject });
      if (pending.length === 1) queueMicrotask(() => { void flush(); });
    });
  }
  return {
    gitResult: args => enqueue({ kind: "git", args }),
    async workingFile(path) {
      if (path.startsWith("/")) throw new Error("File path must be repository-relative");
      const within = relative(workdir, join(workdir, path));
      if (within === ".." || within.startsWith(`..${sep}`)) throw new Error("File path escapes repository");
      const result = await enqueue({ kind: "working-file", path });
      if (result.exitCode === 44) return undefined;
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Couldn’t read workspace file");
      const separator = result.stdout.indexOf(10);
      if (separator !== 6) throw new Error("Invalid workspace file response");
      return { mode: result.stdout.subarray(0, separator).toString(), contents: result.stdout.subarray(separator + 1) };
    },
    async captureIndexTree() {
      const result = await enqueue({ kind: "index-tree" });
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Couldn’t capture workspace index");
      return result.stdout;
    },
  };
}

export async function gitResult(root: Repository, args: string[]): Promise<GitResult> {
  return root.gitResult(args);
}

export async function git(root: Repository, args: string[], allowFailure = false): Promise<Buffer> {
  const result = await gitResult(root, args);
  if (result.exitCode !== 0 && !allowFailure) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.exitCode === 0 ? result.stdout : Buffer.alloc(0);
}

/** Root and initialized nested submodules, expressed as workspace-relative paths. */
export async function repositoryPaths(root: Repository): Promise<string[]> {
  const inside = await gitResult(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.exitCode !== 0) {
    if (inside.stderr.includes("not a git repository")) return [];
    throw new Error(inside.stderr.trim() || "could not inspect workspace repository");
  }
  if (inside.stdout.toString("utf8").trim() !== "true") return [];
  const submodules = await gitResult(root, ["submodule", "foreach", "--quiet", "--recursive", "printf '%s\\0' \"$displaypath\""]);
  if (submodules.exitCode !== 0) throw new Error(submodules.stderr || "could not enumerate workspace submodules");
  return ["", ...submodules.stdout.toString("utf8").split("\0").filter(Boolean)];
}
