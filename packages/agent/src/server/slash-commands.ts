import { contentRowHtml } from "@agents-in-the-cloud/design-system/content-row";
import { autocompleteHtml } from "@agents-in-the-cloud/design-system/autocomplete";
import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { escapeHtml } from "@agents-in-the-cloud/shared";
import { builtinSlashCommands, type BuiltinSlashCommand } from "./builtin-slash-commands.ts";
import type { PromptTemplate } from "./prompt-templates.ts";

type SlashCommand = BuiltinSlashCommand | {
  kind: "prompt-template";
  trigger: string;
  description: string;
  argumentHint?: string;
  prompt: string;
  shortcut?: string;
} | {
  kind: "skill";
  trigger: string;
  description: string;
  argumentHint?: never;
};

export function slashCommands(templates: readonly PromptTemplate[], skills: readonly Pick<Skill, "name" | "description">[], mode: "builtin" | "cli" = "builtin"): SlashCommand[] {
  const commands: SlashCommand[] = [
    ...builtinSlashCommands.filter((command) => mode === "builtin" || command.trigger !== "/compact"),
    ...templates.filter((template) => template.trigger !== "/tree").map((template) => ({
      kind: "prompt-template" as const,
      trigger: template.trigger,
      description: template.description,
      argumentHint: template.argumentHint,
      prompt: template.prompt,
      shortcut: template.shortcut,
    })),
  ];
  return [
    ...(mode === "builtin" ? [{ kind: "builtin" as const, name: "tree", trigger: "/tree", description: "Coming soon." }] : []),
    ...commands.sort((left, right) => left.trigger.localeCompare(right.trigger)),
    ...skills.map((skill) => ({ kind: "skill" as const, trigger: `/skill:${skill.name}`, description: skill.description })),
  ];
}

export function renderSlashCommandCatalog(templates: readonly PromptTemplate[], skills: readonly Pick<Skill, "name" | "description">[], mode: "builtin" | "cli" = "builtin"): string {
  const commands = slashCommands(templates, skills, mode);
  const promptTemplateButtons = templates.filter((template) => template.composerButton).map((template) => {
    const shortcut = template.shortcut;
    const shortcutData = shortcut ? ` data-prompt-template-shortcut="${escapeHtml(shortcut)}"` : "";
    return buttonHtml({
      type: "button",
      variant: "secondary",
      content: { kind: "caption", caption: template.trigger },
      attributesHtml: `data-agent-completion-option data-agent-prompt-template-button data-completion-kind="prompt-template-button" data-command-trigger="${escapeHtml(template.trigger)}"${shortcutData}`,
    });
  }).join("");
  const promptTemplateButtonCatalog = promptTemplateButtons ? `<div class="agent-prompt-template-buttons" data-popular-button="touch" role="group" aria-label="Prompt template buttons">${promptTemplateButtons}</div>` : "";
  const slashCommandCatalog = autocompleteHtml({ kind: "results", label: "Slash commands", contentHtml: commands.map((command, index) => {
    // Keep existing previews for built-in actions without modelling them as Prompt templates.
    const preview = command.kind === "prompt-template" ? command.prompt : command.kind === "builtin" && command.trigger !== "/tree" ? command.trigger : undefined;
    const hasPreview = preview !== undefined;
    return contentRowHtml({
      width: "fill",
      kind: "compact",
      label: { kind: "text", text: `${command.trigger}${command.argumentHint ? ` ${command.argumentHint}` : ""} — ${command.description}` },
      trailingHtml: preview === undefined ? "" : `<template data-agents-in-the-cloud-fullscreen-target="content"><pre class="agent-slash-command-preview">${escapeHtml(preview)}</pre></template>`,
      element: {
        tag: "button",

        attributesHtml: `type="button" role="option" aria-selected="${index === 0 ? "true" : "false"}" data-completion-kind="${command.kind}" data-command-trigger="${escapeHtml(command.trigger)}"${command.kind === "prompt-template" && command.shortcut ? ` data-prompt-template-shortcut="${escapeHtml(command.shortcut)}"` : ""}${command.trigger === "/tree" ? ` data-command-action="notice" data-command-message="/tree feature is coming soon!"` : ""}${hasPreview ? ` data-controller="agents-in-the-cloud-fullscreen" data-agents-in-the-cloud-fullscreen-mode-value="template" data-agents-in-the-cloud-fullscreen-title-value="${escapeHtml(command.trigger)}"` : ""}`,
      },
    });
  }).join("") });
  return `${promptTemplateButtonCatalog}${slashCommandCatalog}`;
}
