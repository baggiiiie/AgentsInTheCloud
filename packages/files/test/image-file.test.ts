import { expect, test } from "bun:test";
import { isImageFile } from "../src/image-file.ts";

test("recognizes browser image formats without inspecting file contents", () => {
  for (const extension of ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]) {
    expect(isImageFile(`/tmp/screenshot.${extension}`)).toBe(true);
    expect(isImageFile(`/work/large.${extension.toUpperCase()}`)).toBe(true);
  }
  for (const path of ["/work/readme.md", "/work/image.png.txt", "/work/page.html", "/work/document.pdf", "/work/movie.mp4", "/work/no-extension"]) {
    expect(isImageFile(path)).toBe(false);
  }
});
