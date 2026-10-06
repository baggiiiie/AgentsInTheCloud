import type { GitResult } from "./git-repository.ts";

export type RepositoryRequest = { kind: "git"; args: string[] } | { kind: "working-file"; path: string } | { kind: "index-tree" };

/** Fixed trusted source, not loaded from the repository. Requests travel on stdin, never in shell source or argv. */
export const repositoryBatchRunner = String.raw`
const { lstat, readFile, readlink, mkdtemp, copyFile, rm } = require('node:fs/promises');
const { resolve, join, relative, sep } = require('node:path');
const { tmpdir } = require('node:os');
const requests = JSON.parse(await Bun.stdin.text());
async function execute(args, env) {
  const child = Bun.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).arrayBuffer(), child.exited]);
  return { stdout: Buffer.from(stdout), stderr: Buffer.from(stderr), exitCode };
}
async function run(request) {
  if (request.kind === 'git') return execute(request.args);
  if (request.kind === 'working-file') {
    const path = resolve(request.path), within = relative(process.cwd(), path);
    if (within === '..' || within.startsWith('..' + sep)) throw new Error('File path escapes repository');
    try {
      const info = await lstat(path);
      if (!info.isFile() && !info.isSymbolicLink()) return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 44 };
      const mode = info.isSymbolicLink() ? '120000' : info.mode & 0o111 ? '100755' : '100644';
      const contents = info.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
      return { stdout: Buffer.concat([Buffer.from(mode + '\n'), contents]), stderr: Buffer.alloc(0), exitCode: 0 };
    } catch (error) {
      if (error.code === 'ENOENT') return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 44 };
      throw error;
    }
  }
  if (request.kind !== 'index-tree') throw new Error('Unknown repository request');
  const directory = await mkdtemp(join(tmpdir(), 'changes-index-'));
  try {
    const index = await execute(request.args);
    if (index.exitCode !== 0) return index;
    try { await copyFile(resolve(index.stdout.toString().trim()), join(directory, 'index')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return await execute(request.writeArgs, { ...process.env, GIT_INDEX_FILE: join(directory, 'index') });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
// Bounded parallelism inside one exec; output is ordered and byte-length framed.
const results = new Array(requests.length);
let cursor = 0;
const completed = await Promise.allSettled(Array.from({ length: Math.min(4, requests.length) }, async () => {
  while (cursor < requests.length) { const position = cursor++; results[position] = await run(requests[position]); }
}));
const failed = completed.find(result => result.status === 'rejected');
if (failed) throw failed.reason;
for (const result of results) {
  const header = Buffer.alloc(12);
  header.writeInt32BE(result.exitCode, 0);
  header.writeUInt32BE(result.stdout.length, 4);
  header.writeUInt32BE(result.stderr.length, 8);
  process.stdout.write(header); process.stdout.write(result.stdout); process.stdout.write(result.stderr);
}
`;

export function decodeRepositoryBatch(output: Buffer, count: number): GitResult[] {
  const results: GitResult[] = [];
  let offset = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 12 > output.length) throw new Error("Truncated repository batch header");
    const exitCode = output.readInt32BE(offset);
    const stdoutLength = output.readUInt32BE(offset + 4), stderrLength = output.readUInt32BE(offset + 8);
    offset += 12;
    if (offset + stdoutLength + stderrLength > output.length) throw new Error("Truncated repository batch payload");
    const stdout = output.subarray(offset, offset + stdoutLength);
    offset += stdoutLength;
    const stderr = output.subarray(offset, offset + stderrLength).toString();
    offset += stderrLength;
    results.push({ exitCode, stdout, stderr });
  }
  if (offset !== output.length) throw new Error("Unexpected repository batch payload");
  return results;
}
