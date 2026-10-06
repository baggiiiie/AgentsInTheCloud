import { copyFile, lstat, mkdtemp, readFile, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isNotFoundError } from "@agents-in-the-cloud/core";
import { join, relative, resolve, sep } from "node:path";
import { decodeRepositoryBatch, repositoryBatchRunner, type RepositoryRequest } from "./repository-batch.ts";
import { execWorkspaceCommandBuffer, workspaceRoot } from "@agents-in-the-cloud/workspace";

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
export function workspaceRepository(workspaceId: string, path = ""): Repository {
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
        const result = await execWorkspaceCommandBuffer(workspaceId, safeGitArguments(batch[0]!.request.args), { workdir });
        batch[0]!.resolve(result);
        return;
      }
      const requests = batch.map(({ request }) => request.kind === "git" ? { ...request, args: safeGitArguments(request.args) }
        : request.kind === "index-tree" ? { ...request, args: safeGitArguments(["rev-parse", "--git-path", "index"]), writeArgs: safeGitArguments(["write-tree"]) } : request);
      const result = await execWorkspaceCommandBuffer(workspaceId, ["bun", "--no-env-file", "--config=/dev/null", "--eval", repositoryBatchRunner], { workdir, stdin: JSON.stringify(requests) });
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

/** Explicitly trusted host repositories for local tools and domain fixtures; application workspaces never use this adapter. */
export function localRepository(root: string): Repository {
  const repository: Repository = {
    async gitResult(args) {
      try { await stat(root); }
      catch (error) {
        if (!isNotFoundError(error)) throw error;
        return { exitCode: 128, stderr: "Repository directory not found", stdout: Buffer.alloc(0) };
      }
      const process = Bun.spawn(safeGitArguments(args), { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text(), process.exited]);
      return { stdout: Buffer.from(stdout), stderr, exitCode };
    },
    async workingFile(path) {
      const absolute = join(root, path), within = relative(root, absolute);
      if (within === ".." || within.startsWith(`..${sep}`)) throw new Error("File path escapes repository");
      try {
        const info = await lstat(absolute);
        if (info.isSymbolicLink()) return { contents: Buffer.from(await readlink(absolute)), mode: "120000" };
        if (!info.isFile()) return undefined;
        return { contents: await readFile(absolute), mode: info.mode & 0o111 ? "100755" : "100644" };
      } catch (error) { if (isNotFoundError(error)) return undefined; throw error; }
    },
    async captureIndexTree() {
      const directory = await mkdtemp(join(tmpdir(), "changes-index-"));
      const index = join(directory, "index");
      try {
        const result = await repository.gitResult(["rev-parse", "--git-path", "index"]);
        if (result.exitCode !== 0) throw new Error(result.stderr);
        try { await copyFile(resolve(root, result.stdout.toString().trim()), index); }
        catch (error) { if (!isNotFoundError(error)) throw error; }
        const process = Bun.spawn(safeGitArguments(["write-tree"]), { cwd: root, env: { ...Bun.env, GIT_INDEX_FILE: index }, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text(), process.exited]);
        if (exitCode !== 0) throw new Error(stderr.trim());
        return Buffer.from(stdout);
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
  return repository;
}
