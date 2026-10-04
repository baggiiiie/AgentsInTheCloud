import { posix } from "node:path";
import { workspaceFileOpenUrl } from "@agents-in-the-cloud/shared";

interface AgentsInTheCloudFilePosition {
  line?: number;
  column?: number;
}

export function agentsInTheCloudFileHref(workspaceId: string, rawHref: string, sourcePath?: string): string | undefined {
  let url: URL;
  try {
    url = new URL(rawHref);
  } catch {
    if (rawHref.startsWith("#") || rawHref.startsWith("?") || rawHref.startsWith("//")) return undefined;
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(rawHref.split(/[?#]/, 1)[0]!);
    } catch {
      return undefined;
    }
    if (!relativePath || relativePath.includes("\0")) return undefined;
    return workspaceFileOpenUrl(workspaceId, posix.resolve(sourcePath ? posix.dirname(sourcePath) : "/work", relativePath));
  }
  const isFileUrl = url.protocol === "file:" && (url.hostname === "" || url.hostname === "localhost");
  if (!isFileUrl && (url.protocol !== "agents-in-the-cloud:" || url.hostname !== "file")) return undefined;

  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (!path || path.includes("\0")) return undefined;
  const position: AgentsInTheCloudFilePosition = {};
  for (const name of ["line", "column"] as const) {
    const value = url.searchParams.get(name);
    if (value && /^\d+$/.test(value)) position[name] = Number(value);
  }
  return workspaceFileOpenUrl(workspaceId, path, position);
}
