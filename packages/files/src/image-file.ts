import { posix } from "node:path";

/** Browser-displayable images are streamed, not loaded into the text editor. */
export function isImageFile(path: string): boolean {
  return /^(?:\.png|\.jpe?g|\.gif|\.webp|\.svg|\.avif|\.bmp)$/i.test(posix.extname(path));
}
