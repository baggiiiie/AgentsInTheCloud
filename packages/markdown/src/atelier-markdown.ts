import { posix } from "node:path";
import { workspaceFileOpenUrl } from "@atelier/shared";

interface AtelierFilePosition {
  line?: number;
  column?: number;
}

export function atelierFileHref(workspaceId: string, rawHref: string, sourcePath?: string): string | undefined {
  let url: URL;
  try {
    url = new URL(rawHref);
  } catch {
    if (!sourcePath || rawHref.startsWith("#") || rawHref.startsWith("?") || rawHref.startsWith("//")) return undefined;
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(rawHref.split(/[?#]/, 1)[0]!);
    } catch {
      return undefined;
    }
    if (!relativePath) return undefined;
    return workspaceFileOpenUrl(workspaceId, posix.resolve(posix.dirname(sourcePath), relativePath));
  }
  if (url.protocol !== "atelier:" || url.hostname !== "file") return undefined;

  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  const position: AtelierFilePosition = {};
  for (const name of ["line", "column"] as const) {
    const value = url.searchParams.get(name);
    if (value && /^\d+$/.test(value)) position[name] = Number(value);
  }
  return workspaceFileOpenUrl(workspaceId, path, position);
}
