import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { agentsInTheCloudDataPath, getAgentsInTheCloudRuntimeContext, readTextIfExists } from "@agents-in-the-cloud/core";
import { Type } from "typebox";
import { Value } from "typebox/value";

const initialPromptDraftSchema = Type.Object({
  prompt: Type.String(),
  accepted: Type.Optional(Type.Boolean()),
});

function initialPromptDraftWorkspacePath(workspaceId: string): string {
  return agentsInTheCloudDataPath(getAgentsInTheCloudRuntimeContext(), "agent-initial-prompt-drafts", workspaceId);
}

function initialPromptDraftPath(workspaceId: string, conversationId: string): string {
  return `${initialPromptDraftWorkspacePath(workspaceId)}/${conversationId}.json`;
}

export async function stageInitialPrompt(workspaceId: string, conversationId: string, prompt: string): Promise<void> {
  const path = initialPromptDraftPath(workspaceId, conversationId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ prompt })}\n`, "utf8");
}

export async function readInitialPromptDraft(workspaceId: string, conversationId: string): Promise<{ prompt: string } | undefined> {
  const text = await readTextIfExists(initialPromptDraftPath(workspaceId, conversationId));
  if (text === undefined) return undefined;
  const draft = Value.Parse(initialPromptDraftSchema, JSON.parse(text));
  if (draft.accepted === false) {
    await removeInitialPromptDraft(workspaceId, conversationId);
    return undefined;
  }
  return { prompt: draft.prompt };
}

export async function removeInitialPromptDraft(workspaceId: string, conversationId: string): Promise<void> {
  await rm(initialPromptDraftPath(workspaceId, conversationId), { force: true });
}

export async function removeWorkspaceInitialPromptDrafts(workspaceId: string): Promise<void> {
  await rm(initialPromptDraftWorkspacePath(workspaceId), { recursive: true, force: true });
}
