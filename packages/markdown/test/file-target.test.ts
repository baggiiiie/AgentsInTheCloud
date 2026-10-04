import { expect, test } from "bun:test";
import { agentsInTheCloudFileHref } from "../src/agents-in-the-cloud-markdown.ts";

function target(href: string, sourcePath?: string): URL | undefined {
  const resolved = agentsInTheCloudFileHref("workspace", href, sourcePath);
  return resolved ? new URL(resolved, "http://localhost") : undefined;
}

test("resolves explicit local file references without filesystem access", () => {
  for (const href of ["/work/image.png", "image.png", "./image.png", "file:///work/image.png", "file://localhost/work/image.png", "agents-in-the-cloud://file/work/image.png"]) {
    expect(target(href)?.searchParams.get("path")).toBe("/work/image.png");
  }
  expect(target("../image.png", "/work/docs/README.md")?.searchParams.get("path")).toBe("/work/image.png");
  expect(target("/tmp/image.png")?.searchParams.get("path")).toBe("/tmp/image.png");
});

test("decodes filenames and preserves explicit file positions", () => {
  expect(target("/work/a%20b%23c.png")?.searchParams.get("path")).toBe("/work/a b#c.png");
  const resolved = target("agents-in-the-cloud://file/work/main.ts?line=42&column=3");
  expect(resolved?.searchParams.get("line")).toBe("42");
  expect(resolved?.searchParams.get("column")).toBe("3");
  expect(target("agents-in-the-cloud://file/work/main.ts?line=no")?.searchParams.has("line")).toBe(false);
});

test("does not treat external URLs, anchors, or invalid paths as local files", () => {
  for (const href of ["https://example.com/image.png", "javascript:alert(1)", "data:text/html,test", "file://remote/work/image.png", "//example.com/image.png", "#section", "?query=1", "/work/%ZZ.png", "/work/%00.png", "agents-in-the-cloud://file/work/%00.png"]) {
    expect(target(href)).toBeUndefined();
  }
});
