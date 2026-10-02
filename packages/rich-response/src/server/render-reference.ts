import type { MarkdownEmbedContext } from "@atelier/markdown";
import { escapeHtml } from "@atelier/shared";

export function renderRichResponseReference({ workspaceId, target, title, provisional }: MarkdownEmbedContext): string {
  let path: string;
  try {
    path = decodeURI(target);
  } catch {
    return escapeHtml(`atelier-rich:${target}`);
  }
  if (!path.startsWith("/") || path.includes("\0")) return escapeHtml(`atelier-rich:${target}`);
  if (provisional) return '<span role="status">Preparing visual explanation…</span>';

  const url = `/workspaces/${encodeURIComponent(workspaceId)}/rich-responses?path=${encodeURIComponent(path)}`;
  const label = title || "Visual explanation";
  return `<span role="group" aria-label="${escapeHtml(label)}" class="rich-response" data-controller="rich-response" data-rich-response-url-value="${escapeHtml(url)}"><span data-rich-response-target="status" role="status">Loading visual explanation…</span><iframe title="${escapeHtml(label)}" sandbox="allow-scripts" referrerpolicy="no-referrer" data-rich-response-target="frame" data-action="load->rich-response#loaded" hidden></iframe></span>`;
}
