import { renderAtelierEmbed } from "./atelier-markdown.ts";

export interface MarkdownEmbedContext {
  workspaceId: string;
  /** Markdown-normalized target after the scheme; decoding belongs to the handler. */
  target: string;
  title: string;
  /** The reference is in a mutable streaming tail, not committed Markdown. */
  provisional: boolean;
}

/** Return trusted server-rendered HTML; escape any untrusted values. */
export type MarkdownEmbedHandler = (context: MarkdownEmbedContext) => string;

const handlers = new Map<string, MarkdownEmbedHandler>([
  ["atelier-embed", ({ workspaceId, target }) => renderAtelierEmbed(workspaceId, target)],
]);

/** Register once during server startup, before rendering requests. */
export function registerMarkdownEmbed(scheme: string, handler: MarkdownEmbedHandler): void {
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) throw new Error(`Invalid Markdown embed scheme: ${scheme}`);
  if (handlers.has(scheme)) throw new Error(`Markdown embed scheme already registered: ${scheme}`);
  handlers.set(scheme, handler);
}

export function renderMarkdownEmbed(source: string, context: Omit<MarkdownEmbedContext, "target">): string | undefined {
  const separator = source.indexOf(":");
  if (separator < 0) return undefined;
  return handlers.get(source.slice(0, separator))?.({ ...context, target: source.slice(separator + 1) });
}
