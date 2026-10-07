interface ImageMimeTypeRegistry {
  [extension: string]: string;
}

export const imageMimeByExtension: ImageMimeTypeRegistry = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
};

export function extensionOf(path: string): string {
  return (path.split(".").pop() ?? "").toLowerCase();
}
