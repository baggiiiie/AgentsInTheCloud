import { copyFile, lstat, mkdtemp, readFile, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { isNotFoundError } from "@agents-in-the-cloud/core";
import { safeGitArguments, type Repository } from "../../src/git-repository.ts";

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
