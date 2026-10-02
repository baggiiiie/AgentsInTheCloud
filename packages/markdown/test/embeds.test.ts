import { expect, test } from "bun:test";
import { registerMarkdownEmbed, renderMarkdown, renderStreamingMarkdownSnapshot, type MarkdownEmbedContext } from "../src/index.ts";

test("registered schemes receive parsed references, not code or unrelated images", () => {
  const calls: MarkdownEmbedContext[] = [];
  registerMarkdownEmbed("test-reference", (context) => { calls.push(context); return ""; });
  renderMarkdown("workspace", [
    "![Caption](test-reference:/work/a%20b.html)",
    "",
    "`![](test-reference:/inline.html)`",
    "",
    "```md",
    "![](test-reference:/fenced.html)",
    "```",
    "",
    "![](unknown-scheme:/other.html)",
    "",
    "![Ordinary](https://example.com/image.png)",
  ].join("\n"));
  expect(calls).toEqual([{ workspaceId: "workspace", target: "/work/a%20b.html", title: "Caption", provisional: false }]);
});

test("handlers can distinguish mutable streaming references from completed content", () => {
  const calls: MarkdownEmbedContext[] = [];
  registerMarkdownEmbed("test-streaming", (context) => { calls.push(context); return ""; });
  const text = "![Example](test-streaming:/work/example.html)";
  renderStreamingMarkdownSnapshot("workspace", text);
  renderMarkdown("workspace", text);
  expect(calls.map(({ provisional }) => provisional)).toEqual([true, false]);
});

test("scheme registration rejects invalid names and duplicate ownership", () => {
  expect(() => registerMarkdownEmbed("invalid:", () => "")).toThrow("Invalid Markdown embed scheme");
  registerMarkdownEmbed("test-exclusive", () => "");
  expect(() => registerMarkdownEmbed("test-exclusive", () => "")).toThrow("already registered");
});
