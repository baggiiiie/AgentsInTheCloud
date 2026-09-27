import { listPromptTemplates } from "./prompt-templates.ts";
import { loadWorkspaceSkills } from "./skills.ts";
import { renderSlashCommandCatalog } from "./slash-commands.ts";

export async function renderWorkspaceCompletionCatalog(workspaceId: string, mode: "builtin" | "cli" = "builtin"): Promise<string> {
  if (mode === "cli") {
    const templates = (await listPromptTemplates(workspaceId)).filter((template) => !["/compact", "/name", "/tree"].includes(template.trigger));
    return renderSlashCommandCatalog(templates, [], false);
  }
  const [templates, { skills }] = await Promise.all([listPromptTemplates(workspaceId), loadWorkspaceSkills(workspaceId)]);
  return renderSlashCommandCatalog(templates, skills);
}
