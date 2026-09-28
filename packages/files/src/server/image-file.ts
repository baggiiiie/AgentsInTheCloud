import { posix } from "node:path";

// The workspace file proxy serves these extensions with image content types.
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp"]);

export function isImageFile(path: string): boolean {
  return imageExtensions.has(posix.extname(path).toLowerCase());
}
