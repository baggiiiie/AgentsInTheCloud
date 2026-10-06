import { builtinSlashCommands } from "./builtin-slash-commands.ts";
import { expandPromptTemplateText, listPromptTemplates, type PromptTemplate } from "./prompt-templates.ts";

/** Built-in actions retain their command syntax; only Prompt templates expand into prompt text. */
export function expandSlashCommandText(text: string, templates: readonly PromptTemplate[]): string {
  const trimmed = text.trim();
  const trigger = trimmed.match(/^(\/[^\s]+)(?:\s+[\s\S]*)?$/)?.[1];
  const command = builtinSlashCommands.find((candidate) => candidate.trigger === trigger);
  if (command) return command.preserveArguments ? trimmed : command.trigger;
  return expandPromptTemplateText(text, templates);
}

export async function expandSlashCommand(workspaceId: string, text: string): Promise<string> {
  return expandSlashCommandText(text, await listPromptTemplates(workspaceId));
}
