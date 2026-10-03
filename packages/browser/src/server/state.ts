import type { JsonValue } from "@agents-in-the-cloud/core";
import { domId } from "@agents-in-the-cloud/shared";
import { createWorkspaceMetadataState } from "@agents-in-the-cloud/workspace";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const workspaceBrowserViewSchema = Type.Object({
  key: Type.String({ pattern: "^browser-[a-zA-Z0-9-]+$" }),
  label: Type.String(),
  targetUrl: Type.String(),
});

const workspaceBrowserViewsSchema = Type.Array(workspaceBrowserViewSchema);

export type WorkspaceBrowserView = Static<typeof workspaceBrowserViewSchema>;

function parseBrowserViews(value: JsonValue): WorkspaceBrowserView[] {
  return Value.Parse(workspaceBrowserViewsSchema, Value.Clean(workspaceBrowserViewsSchema, value));
}

const browserViews = createWorkspaceMetadataState("browser-work-views.json", parseBrowserViews, () => []);
// Bumped on every navigation so re-navigating to the same URL still reloads the preview iframe.
const browserNavigationCounts = new Map<string, number>();

function navigationCountKey(workspaceId: string, appKey: string): string {
  return `${workspaceId}/${appKey}`;
}

export function browserNavigationCount(workspaceId: string, appKey: string): number {
  return browserNavigationCounts.get(navigationCountKey(workspaceId, appKey)) ?? 0;
}

export function browserFrameId(workspaceId: string, appKey: string): string {
  return domId("browser_frame", workspaceId, appKey);
}

export function listWorkspaceBrowserViews(workspaceId: string): WorkspaceBrowserView[] {
  return browserViews.read(workspaceId);
}

export function getWorkspaceBrowserView(workspaceId: string, appKey: string): WorkspaceBrowserView | undefined {
  return browserViews.read(workspaceId).find((view) => view.key === appKey);
}

export function createWorkspaceBrowserView(workspaceId: string): WorkspaceBrowserView {
  const existing = listWorkspaceBrowserViews(workspaceId);
  const index = existing.length + 1;
  const view = { key: `browser-${crypto.randomUUID()}`, label: `Browser ${index}`, targetUrl: "" };
  existing.push(view);
  browserViews.write(workspaceId, existing);
  return view;
}

export function deleteWorkspaceBrowserView(workspaceId: string, appKey: string): void {
  browserViews.write(workspaceId, browserViews.read(workspaceId).filter((view) => view.key !== appKey));
  browserNavigationCounts.delete(navigationCountKey(workspaceId, appKey));
}

export function setWorkspaceBrowserTarget(workspaceId: string, appKey: string, input: string): WorkspaceBrowserView | undefined {
  const view = getWorkspaceBrowserView(workspaceId, appKey);
  if (!view) return undefined;
  view.targetUrl = normalizeBrowserUrl(input);
  browserViews.write(workspaceId, browserViews.read(workspaceId));
  browserNavigationCounts.set(navigationCountKey(workspaceId, appKey), browserNavigationCount(workspaceId, appKey) + 1);
  return view;
}

export function deleteWorkspaceBrowserState(workspaceId: string): void {
  for (const view of browserViews.read(workspaceId)) browserNavigationCounts.delete(navigationCountKey(workspaceId, view.key));
  browserViews.delete(workspaceId);
}

export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  if (!parsed.hostname) return "";
  return parsed.toString();
}
