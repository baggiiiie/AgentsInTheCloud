import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { getAtelierRuntimeContext } from "@atelier/core";
import { publishSessionSnapshot, sessionShareDir, workspaceSessionShareKey } from "@atelier/agent/server";
import { workspaceRoot } from "@atelier/workspace";

export async function nativeJsonlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await nativeJsonlFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}

/** Copy only native conversation files, never config, MCP tokens or authentication files. */
export async function exportCliHistory(workspaceId: string, provider: string, tabId: string, slug: string): Promise<void> {
  const dataDir = getAtelierRuntimeContext().atelierDataDir;
  const workspaceShare = join(dataDir, "workspaces", workspaceId, "home-local", ".local", "share");
  let sources: string[];
  switch (provider) {
    case "pi": sources = await nativeJsonlFiles(join(workspaceShare, "pi", "sessions", tabId)); break;
    case "codex": sources = await nativeJsonlFiles(join(workspaceShare, "atelier-agents", tabId, "codex", "sessions")); break;
    case "claude": {
      const path = join(dataDir, "home", ".claude", "projects", workspaceRoot.replaceAll("/", "-"), `${tabId}.jsonl`);
      sources = await Bun.file(path).exists() ? [path] : [];
      break;
    }
    default: throw new Error(`Unsupported CLI history provider: ${provider}`);
  }
  if (!sources.length) return;
  const destination = sessionShareDir(await workspaceSessionShareKey(workspaceId));
  for (const source of sources) {
    const nativeId = basename(source, ".jsonl").replace(/[^a-zA-Z0-9-]/g, "-");
    await publishSessionSnapshot(source, join(destination, `${provider}--${slug}--${workspaceId}--${tabId}--${nativeId}.jsonl`));
  }
}
