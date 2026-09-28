import { expect, test } from "bun:test";
import { isImageFile } from "../src/server/image-file.ts";

test("recognizes image formats served by the workspace file proxy", () => {
  for (const extension of ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]) {
    expect(isImageFile(`/work/preview.${extension}`)).toBe(true);
  }
  expect(isImageFile("/work/PHOTO.PNG")).toBe(true);
  expect(isImageFile("/work/preview.png.txt")).toBe(false);
});
