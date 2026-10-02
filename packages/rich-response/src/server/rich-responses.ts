import { execWorkspaceCommand } from "@atelier/workspace";

export const richResponseMaxBytes = 1024 * 1024;
export type RichResponseFragment = { html: string } | { error: string };

export function validateRichResponse(html: string): RichResponseFragment {
  if (Buffer.byteLength(html) > richResponseMaxBytes) return { error: "This visual is too large. Ask the agent to keep it under 1 MiB." };
  if (!html.trim()) return { error: "The visual explanation file was empty." };
  if (/<\s*(?:!doctype|html\b|head\b|body\b)/i.test(html)) return { error: "This visual is a full page. Ask the agent to write an HTML fragment instead." };
  return { html };
}

export async function readRichResponse(workspaceId: string, path: string): Promise<RichResponseFragment> {
  const result = await execWorkspaceCommand(workspaceId, ["head", "-c", String(richResponseMaxBytes + 1), "--", path]);
  if (result.exitCode !== 0) return { error: "The visual explanation file could not be read. Ask the agent to check the file, then reload." };
  return validateRichResponse(result.stdout);
}

