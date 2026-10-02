import { AtelierCoreError } from "@atelier/core";
import { actionItemHtml } from "@atelier/design-system/action-item";
import { buttonHtml } from "@atelier/design-system/button";
import { escapeHtml } from "@atelier/shared";

export const treeFilterOptions = [
  ["default", "Default"],
  ["no-tools", "No tools"],
  ["user-only", "User only"],
  ["labeled-only", "Labeled"],
  ["all", "All entries"],
] as const;

export type TreeFilterMode = typeof treeFilterOptions[number][0];

export function parseTreeFilterMode(value: string | null): TreeFilterMode {
  return treeFilterOptions.find(([mode]) => mode === value)?.[0] ?? "default";
}

function treeSummaryOptionHtml(mode: "none" | "summary" | "custom", title: string, description: string, active = false): string {
  return actionItemHtml({
    kind: "single",
    label: { kind: "text", text: title },
    description,
    element: {
      tag: "button",

      attributesHtml: `type="button" role="option" aria-selected="${active}" data-completion-kind="tree-summary" data-summary-mode="${mode}"`,
    },
  });
}

export function renderAgentTreeSummaryMenu(entryId: string, summaryAvailable = true): string {
  const backButton = buttonHtml({
    type: "button",
    variant: "secondary",
    content: { kind: "caption", caption: "Back" },
    attributesHtml: 'data-completion-kind="tree-summary-back"',
  });
  const confirmButton = buttonHtml({
    type: "button",
    variant: "primary",
    content: { kind: "caption", caption: "Summarize and continue" },
    attributesHtml: 'data-completion-kind="tree-summary-confirm"',
  });
  return `<div class="agent-completion-menu agent-tree-summary-menu" role="listbox" aria-label="Branch summary choice" data-tree-entry="${escapeHtml(entryId)}">
    <header class="agent-tree-header"><span class="agent-tree-heading"><b>Continue from this point</b><span>What should happen to the branch you’re leaving?</span></span></header>
    <div class="agent-tree-summary-choices action-list">
      ${treeSummaryOptionHtml("none", summaryAvailable ? "No summary" : "Continue on a new branch", summaryAvailable ? "Switch state without carrying anything forward." : "Keep earlier branches in history without adding a summary.", true)}
      ${summaryAvailable ? treeSummaryOptionHtml("summary", "Summarize", "Ask the agent to preserve useful context from the branch.") : ""}
      ${summaryAvailable ? treeSummaryOptionHtml("custom", "Summarize with additional instructions", "Add guidance for what the summary should retain.") : ""}
    </div>
    <div class="agent-tree-custom" hidden>
      <label for="agent-tree-custom-instructions">Additional summary instructions</label>
      <textarea class="textarea" id="agent-tree-custom-instructions" rows="3" placeholder="For example: preserve the API decisions and unresolved risks."></textarea>
      <div>${backButton}${confirmButton}</div>
    </div>
  </div>`;
}

interface AgentTreeRuntime {
  readonly treeSummaryAvailable?: boolean;
  treeHtml(options: { filter: TreeFilterMode; query: string }): string | Promise<string>;
  labelTreeEntry(entryId: string, label: string, operation: "add" | "remove"): void | Promise<void>;
  navigateTree(entryId: string, options: { summarize: boolean; customInstructions?: string }): Promise<string>;
}

export async function handleAgentTreeRequest(request: Request, url: URL, suffix: string, runtime: () => Promise<AgentTreeRuntime>): Promise<Response | undefined> {
  if (suffix === "/summary" && request.method === "GET") {
    const entry = url.searchParams.get("entry") ?? "";
    if (!entry) throw new AtelierCoreError("invalid_arguments", "tree entry is required");
    return new Response(renderAgentTreeSummaryMenu(entry, (await runtime()).treeSummaryAvailable !== false), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (suffix === "/label" && request.method === "POST") {
    const form = await request.formData();
    const entry = String(form.get("entry") ?? "");
    const label = String(form.get("label") ?? "");
    const operation = form.get("operation");
    if (!entry || !label.trim() || (operation !== "add" && operation !== "remove")) throw new AtelierCoreError("invalid_arguments", "tree entry, label, and valid operation are required");
    await (await runtime()).labelTreeEntry(entry, label, operation);
    return new Response(null, { status: 204 });
  }
  if (suffix === "" && request.method === "GET") {
    const html = await (await runtime()).treeHtml({ filter: parseTreeFilterMode(url.searchParams.get("filter")), query: url.searchParams.get("q") ?? "" });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (suffix === "" && request.method === "POST") {
    const form = await request.formData();
    const entry = String(form.get("entry") ?? "");
    if (!entry) throw new AtelierCoreError("invalid_arguments", "tree entry is required");
    const summaryMode = String(form.get("summaryMode") ?? "none");
    if (summaryMode !== "none" && summaryMode !== "summary" && summaryMode !== "custom") throw new AtelierCoreError("invalid_arguments", "valid summary mode is required");
    const editorText = await (await runtime()).navigateTree(entry, {
      summarize: summaryMode !== "none",
      customInstructions: summaryMode === "custom" ? String(form.get("customInstructions") ?? "") : undefined,
    });
    return new Response(editorText, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return undefined;
}
