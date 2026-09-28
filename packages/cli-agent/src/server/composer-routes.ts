import { expandPromptTemplate, listFileCompletions, renderFileCompletionMenu } from "@atelier/agent/server";
import { agentAttachmentDraftId, copyAttachmentIntoWorkspace, findStagedAttachment, removeStagedAttachments } from "@atelier/prompt/server";
import type { CliSessions } from "./sessions.ts";

export function cliComposerRoutes(providerId: string, sessions: CliSessions) {
  return async (request: Request, url: URL): Promise<Response | undefined> => {
    const match = url.pathname.match(/^\/workspaces\/([^/]+)\/([^/]+)-agents\/([^/]+)\/composer(?:\/(completions(?:\/prompt-template-expand)?|consumed|presented))?$/);
    if (!match || match[2] !== providerId) return undefined;
    const workspaceId = decodeURIComponent(match[1]!);
    const conversationId = decodeURIComponent(match[3]!);
    const operation = match[4] ?? "";
    const session = await sessions.ready(workspaceId, conversationId);
    if (request.method === "GET" && operation === "completions") {
      const html = renderFileCompletionMenu(await listFileCompletions(workspaceId, url.searchParams.get("q") ?? "", url.searchParams.get("mode") === "fuzzy" ? "fuzzy" : "direct"));
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (request.method === "POST" && operation === "completions/prompt-template-expand") {
      const form = await request.formData();
      return new Response(await expandPromptTemplate(workspaceId, String(form.get("text") ?? "")), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (request.method === "POST" && operation === "presented") {
      sessions.acknowledgeFirstPresentation(workspaceId, conversationId);
      return new Response(null, { status: 204 });
    }
    const draftId = agentAttachmentDraftId(workspaceId, `${providerId}:${conversationId}`);
    if (request.method === "POST" && operation === "consumed") {
      const form = await request.formData();
      if (form.get("attachmentDraft") !== draftId) return new Response("Invalid draft", { status: 422 });
      await removeStagedAttachments(draftId, form.getAll("attachment").map(String));
      return new Response(null, { status: 204 });
    }
    if (request.method !== "POST" || operation) return undefined;
    const terminal = await sessions.terminalState(workspaceId, session);
    if (session.error || !terminal.exists || terminal.ended) return new Response("Terminal unavailable", { status: 409 });
    const form = await request.formData();
    if (form.get("attachmentDraft") !== draftId) return new Response("Invalid draft", { status: 422 });
    const ids = form.getAll("attachment").map(String);
    const attachments = await Promise.all(ids.map(async (id) => {
      const attachment = await findStagedAttachment(draftId, id);
      if (!attachment) throw new Error(`Attachment not found: ${id}`);
      return attachment;
    }));
    let text = await expandPromptTemplate(workspaceId, String(form.get("text") ?? ""));
    if (!text.trim() && !attachments.length) return new Response("Enter a prompt or attach a file", { status: 422 });
    const notes: string[] = [];
    for (const attachment of attachments) {
      const path = `/tmp/atelier-attachments/${providerId}-${conversationId}/${attachment.id}/${attachment.name}`;
      await copyAttachmentIntoWorkspace(workspaceId, attachment, path);
      notes.push(`[Attached ${attachment.isImage ? "image" : "file"} available at ${path}]`);
    }
    text = [text, ...notes].filter(Boolean).join("\n\n");
    return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  };
}
