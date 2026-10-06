import { copyFile, lstat, mkdtemp, readFile, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isNotFoundError } from "@agents-in-the-cloud/core";
import { join, relative, resolve, sep } from "node:path";
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
  return ["git", "--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "log.showSignature=false", "-c", "color.ui=false", command, ...options, ...args.slice(1)];
}

const readWorkingFile = `set -eu
if test -L "$1"; then printf '120000\\n'; readlink -n -- "$1"
elif test -f "$1"; then
  if test -x "$1"; then printf '100755\\n'; else printf '100644\\n'; fi
  cat -- "$1"
elif ! test -e "$1"; then exit 44
else exit 45
fi`;
const writeIndexTree = `set -eu
directory=$(mktemp -d)
trap 'rm -rf -- "$directory"' EXIT
index=$(git --no-pager -c core.fsmonitor=false rev-parse --git-path index)
if test -f "$index"; then cp -- "$index" "$directory/index"; fi
GIT_INDEX_FILE="$directory/index" git --no-pager -c core.fsmonitor=false -c core.hooksPath=/dev/null write-tree`;

/** All repository-controlled execution and file reads stay in the workspace, as its regular user. */
export function workspaceRepository(workspaceId: string, path = ""): Repository {
  const workdir = join(workspaceRoot, path);
  const within = relative(workspaceRoot, workdir);
  if (within === ".." || within.startsWith(`..${sep}`)) throw new Error("Repository path escapes workspace");
  const execute = (args: string[]) => execWorkspaceCommandBuffer(workspaceId, args, { workdir });
  return {
    gitResult: args => execute(safeGitArguments(args)),
    async workingFile(path) {
      const within = relative(workdir, join(workdir, path));
      if (within === ".." || within.startsWith(`..${sep}`)) throw new Error("File path escapes repository");
      const result = await execute(["sh", "-c", readWorkingFile, "read-working-file", path]);
      if (result.exitCode === 44 || result.exitCode === 45) return undefined;
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Couldn’t read workspace file");
      const separator = result.stdout.indexOf(10);
      if (separator !== 6) throw new Error("Invalid workspace file response");
      return { mode: result.stdout.subarray(0, separator).toString(), contents: result.stdout.subarray(separator + 1) };
    },
    async captureIndexTree() {
      const result = await execute(["sh", "-c", writeIndexTree]);
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
