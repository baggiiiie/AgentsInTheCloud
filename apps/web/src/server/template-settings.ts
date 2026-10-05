import { invalidArguments } from "@agents-in-the-cloud/core";
import { actionItemHtml } from "@agents-in-the-cloud/design-system/action-item";
import { actionLinkHtml } from "@agents-in-the-cloud/design-system/action-link";
import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { destructiveConfirmationHtml } from "@agents-in-the-cloud/design-system/destructive-confirmation";
import { dialogHtml } from "@agents-in-the-cloud/design-system/dialog";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { panelHtml } from "@agents-in-the-cloud/design-system/panel";
import { toggleHtml } from "@agents-in-the-cloud/design-system/toggle";
import { transientFeedbackHtml } from "@agents-in-the-cloud/design-system/transient-feedback";
import { escapeHtml } from "@agents-in-the-cloud/shared";
import { formatWorkspaceTemplateSpec, getWorkspaceTemplateConfiguration, getWorkspaceTemplateSshKnownHosts, listWorkspaceTemplateSshKeys, secretNeedsValue, workspaceTemplateSecretAllowsPath, type WorkspaceTemplateConfiguration, type WorkspaceTemplateSecretSummary } from "@agents-in-the-cloud/workspace-templates";

export const templateSettingsHostId = "template_settings_host";
export const templateSettingsFrameId = "template_settings_detail";
export type TemplateSettingsSection = "index" | "general" | "secrets" | "ssh" | "environment" | "container";
export interface TemplateSettingsLocation { section?: string; editor?: string }
export interface TemplateSettingsReference { workspaceId: string; title: string }

function sectionFor(value?: string): TemplateSettingsSection | undefined {
  if (value === undefined) return undefined;
  switch (value) {
    case "index": case "general": case "secrets": case "ssh": case "environment": case "container": return value;
    case "repository": return "general";
    case "danger": return "index";
    case "ssh-keys": return "ssh";
    case "dockerfile": case "preload-images": case "privileged": return "container";
    default: throw invalidArguments("Unknown template settings section");
  }
}
const sections = [
  ["general", "General"], ["secrets", "Secrets"], ["ssh", "SSH access"], ["environment", "Environment"], ["container", "Container"],
] as const;
const captionButton = (caption: string, attributesHtml: string, variant: "secondary" | "primary" = "secondary") => buttonHtml({ type: "button", variant, content: { kind: "caption", caption }, attributesHtml });
const paragraph = (text: string) => `<p class="template-settings-note">${escapeHtml(text)}</p>`;
const field = (caption: string, name: string, value: string, attributes = "") => `<label class="form-section"><span>${escapeHtml(caption)}</span><input class="text-field" name="${name}" value="${escapeHtml(value)}" ${attributes}></label>`;
const textarea = (caption: string, name: string, value: string, rows: number, attributes = "") => `<label class="form-section"><span>${caption}</span><textarea class="textarea" name="${name}" rows="${rows}" ${attributes}>${escapeHtml(value)}</textarea></label>`;
function settingsUrl(id: string, section: TemplateSettingsSection, editor?: string): string {
  return `/workspace-templates/${encodeURIComponent(id)}/settings?section=${section}${editor ? `&editor=${encodeURIComponent(editor)}` : ""}`;
}
function navigation(id: string, section: TemplateSettingsSection, caption: string, editor?: string, focus?: string): string {
  return actionLinkHtml({ href: settingsUrl(id, section, editor), variant: "secondary", content: { kind: "caption", caption }, attributesHtml: `data-turbo-frame="${templateSettingsFrameId}"${caption === "Cancel" ? " data-template-settings-cancel" : ""}${focus ? ` data-template-settings-focus="${escapeHtml(focus)}"` : ""}` });
}
function record(id: string, section: TemplateSettingsSection, editor: string, label: string, description: string, status = ""): string {
  const noteId = `template_settings_record_note_${section}_${encodeURIComponent(editor)}`;
  const action = actionItemHtml({ kind: "single", label: { kind: "text", text: label }, trailingHtml: escapeHtml(status), element: { tag: "a", attributesHtml: `href="${settingsUrl(id, section, editor)}" data-turbo-frame="${templateSettingsFrameId}" data-template-settings-record="${escapeHtml(editor || section)}"${description ? ` aria-describedby="${escapeHtml(noteId)}"` : ""}` } });
  return description ? `<div class="template-settings-record">${action}<p class="template-settings-record-note" id="${escapeHtml(noteId)}">${escapeHtml(description)}</p></div>` : action;
}
function form(id: string, path: string, contents: string, saveCaption: string, section: TemplateSettingsSection, editor?: string, extra = "", saved = false): string {
  return `<form class="form-stack" method="post" action="/workspace-templates/${encodeURIComponent(id)}${path}" data-template-settings-target="form" data-action="input->template-settings#changed change->template-settings#changed turbo:submit-start->template-settings#submitting turbo:submit-end->template-settings#submitted" ${extra}>
    ${contents}
    <div class="form-actions" tabindex="-1" data-template-settings-save-actions>${navigation(id, section === "general" ? "index" : section, "Cancel", undefined, editor)}${transientFeedbackHtml({
      element: { tag: "button", variant: "primary", attributesHtml: `type="submit" data-template-settings-save disabled data-transient-feedback-initial-label="${escapeHtml(saveCaption)}" data-transient-feedback-feedback-label="Changes saved"` },
      layout: "overlay", durationMs: 1_200,
      initialContent: { kind: "text", text: saveCaption },
      feedbackContent: { kind: "html", html: Icons.Check },
      state: saved ? "feedback" : "initial", keepEnabledDuringFeedback: true,
    })}</div>
  </form>`;
}
function removeForm(id: string, path: string, section: TemplateSettingsSection, label: string, consequence: string): string {
  return `<div class="template-settings-remove">${paragraph(consequence)}<form method="post" action="/workspace-templates/${encodeURIComponent(id)}${path}" data-action="turbo:submit-start->template-settings#submitting turbo:submit-end->template-settings#submitted">${destructiveConfirmationHtml({ id: `template_remove_${section}_${path.replace(/[^a-zA-Z0-9]/g, "_")}`, trigger: { type: "button", variant: "danger", content: { kind: "caption", caption: label } }, confirmCaption: label, cancelCaption: "Cancel" })}</form></div>`;
}
function selection(label: string, name: string, value: string, options: { value: string; label: string }[], attributes?: string): string {
  return `<div class="form-section"><span>${label}</span><input type="hidden" name="${name}" value="${value}">${toggleHtml({ variant: "button", label, name, value, options, element: { dataAction: `change->template-settings#toggleChanged${attributes ?? ""}` } })}</div>`;
}
function secretEditor(t: WorkspaceTemplateConfiguration, secret?: WorkspaceTemplateSecretSummary, saved = false): string {
  const isNew = !secret;
  const permission = String(secret ? workspaceTemplateSecretAllowsPath(secret) : false);
  const hostAttributes = isNew ? 'data-workspace-template-secret-path-target="host" data-action="input->workspace-template-secret-path#useDefault"' : "";
  const content = `${field("Environment variable", "envName", secret?.envName ?? "", 'required autocomplete="off" autofocus')}
    ${field("Allowed host", "hostPattern", secret?.hostPattern ?? "", `required autocomplete="off" placeholder="api.example.com" ${hostAttributes}`)}
    ${field(secret?.configured ? "Replace secret value" : "Secret value", "secretValue", "", `type="password" autocomplete="new-password" data-1p-ignore${isNew ? ' required' : ''}`)}
    ${paragraph(secret?.configured ? "Leave the value blank to keep the stored secret. Stored values are never shown." : isNew ? "Required secrets need a value. Optional secrets can be added without one. Agents only see a placeholder." : "Agents only see a placeholder. Add the real value here when it’s available.")}
    ${selection("Requirement", "optional", String(secret?.optional ?? false), [{ value: "false", label: "Required" }, { value: "true", label: "Optional" }])}
    <details><summary>Advanced</summary><div class="form-stack">
      ${field("Placeholder", "placeholder", secret?.placeholder ?? "", 'autocomplete="off"')}
      ${paragraph("Leave blank to use an automatically generated placeholder.")}
      ${textarea("Needed for", "annotation", secret?.annotation ?? "", 2)}
      <div class="form-section"><span>Allow substitution in URL paths</span><input type="hidden" name="allowInPath" value="${permission}"${isNew ? ' data-workspace-template-secret-path-target="permission"' : ""}>
      ${toggleHtml({ variant: "button", label: "Allow substitution in URL paths", name: "allowInPath", value: permission, options: [{ value: "false", label: "Disallow" }, { value: "true", label: "Allow" }], element: { dataAction: `${isNew ? "click->workspace-template-secret-path#choose change->workspace-template-secret-path#choose " : ""}change->template-settings#toggleChanged`, data: isNew ? { "workspace-template-secret-path-target": "toggle" } : undefined } })}</div>
      ${paragraph("Allow only if the service needs this secret in its URL path, rather than headers or the request body.")}
    </div></details>`;
  return `${secret ? paragraph(secret.configured ? "Secret stored" : secretNeedsValue(secret) ? "Required secret — needs a value" : "Optional secret — no value stored") : ""}${form(t.id, `/secrets${secret ? `/${encodeURIComponent(secret.id)}` : ""}`, content, isNew ? "Add secret" : "Save changes", "secrets", secret?.id, isNew ? 'data-controller="workspace-template-secret-path" data-template-settings-new-secret' : "", saved)}${secret ? removeForm(t.id, `/secrets/${encodeURIComponent(secret.id)}/delete`, "secrets", "Delete secret", `Delete ${secret.envName} and its stored value. Requests using it will no longer receive this secret.`) : ""}`;
}

export function templateSettingsErrorHtml(message: string): string {
  return `<aside class="warning-banner" role="alert"><div class="warning-banner__header"><strong>Couldn’t save changes</strong>${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Close, label: "Dismiss save error" }, attributesHtml: 'data-action="template-settings#dismissError"' })}</div><div class="warning-banner__body"><p>${escapeHtml(message)}</p></div></aside>`;
}

export async function renderTemplateSettingsFrame(id: string, location: TemplateSettingsLocation, references: TemplateSettingsReference[], saved = false, focusRecord?: string): Promise<string> {
  const t = await getWorkspaceTemplateConfiguration(id);
  const [keys, knownHosts] = await Promise.all([listWorkspaceTemplateSshKeys(id), getWorkspaceTemplateSshKnownHosts(id)]);
  const missing = t.secrets.filter(secretNeedsValue).length;
  const section = sectionFor(location.section) ?? (missing ? "secrets" : "index");
  const editor = location.editor ?? (location.section === "privileged" ? "docker" : location.section === "preload-images" ? "images" : location.section === "dockerfile" ? "dockerfile" : undefined);
  if (editor && !["secrets", "ssh", "environment", "container"].includes(section)) throw invalidArguments("This settings section has no record editor");
  let title: string = sections.find(([value]) => value === section)?.[1] ?? "";
  let content = "";
  let backSection: TemplateSettingsSection = "index";
  if (section === "index") {
    content = `<nav class="action-list" aria-label="Template settings sections">${sections.map(([value, label]) => record(id, value, "", label, "")).join("")}</nav>`;
    content += `<details${location.section === "danger" ? " open" : ""}><summary>Delete template</summary>${references.length ? paragraph(`Delete ${references.length === 1 ? `workspace “${references[0]!.title}”` : `${references.length} workspaces`} first. This template is still in use.`) : removeForm(id, "/delete", section, "Delete template", `Permanently delete template “${t.name}”, including its secrets and SSH keys.`)}</details>`;
  } else if (section === "general") {
    content = form(id, "", `${field("Display name", "name", t.name, 'required autofocus autocomplete="off" data-1p-ignore="true"')}${field("Repository", "gitUrl", formatWorkspaceTemplateSpec(t), 'required')}${paragraph("Repository changes apply to new workspaces. Existing workspaces stay unchanged.")}`, "Save changes", section, undefined, "", saved);
  } else if (section === "secrets") {
    if (editor) {
      const secret = editor === "new" ? undefined : t.secrets.find(s => s.id === editor);
      if (editor !== "new" && !secret) throw invalidArguments("Secret not found");
      title = secret ? "Edit secret" : "Add secret";
      backSection = section;
      content = secretEditor(t, secret, saved);
    } else {
      content = `${paragraph("Agents use placeholders. Real values are substituted in requests to the hosts you allow. Secret changes also apply to existing workspaces.")}<div class="template-settings-toolbar"><span>${t.secrets.length} ${t.secrets.length === 1 ? "secret" : "secrets"}</span>${navigation(id, section, "Add secret", "new")}</div><div class="action-list">${t.secrets.toSorted((a, b) => Number(secretNeedsValue(b)) - Number(secretNeedsValue(a))).map(s => record(id, section, s.id, s.envName, `${s.hostPattern} · ${s.optional ? "Optional" : "Required"}`, s.configured ? "Stored" : secretNeedsValue(s) ? "Needs a value" : "No value")).join("")}</div>${t.secrets.length ? "" : paragraph("No secrets yet. Add one to connect your agents to a service.")}`;
    }
  } else if (section === "environment") {
    if (editor) {
      const variable = editor === "new" ? undefined : t.environment.find(v => v.id === editor);
      if (editor !== "new" && !variable) throw invalidArguments("Environment variable not found");
      title = variable ? "Edit variable" : "Add variable";
      backSection = section;
      content = form(id, `/environment${variable ? `/${encodeURIComponent(variable.id)}` : ""}`, `${field("Name", "name", variable?.name ?? "", 'required autocomplete="off" autofocus')}${field("Value", "value", variable?.value ?? "", 'autocomplete="off"')}${paragraph("Added to new workspace containers. Use Secrets for passwords and API keys.")}`, variable ? "Save changes" : "Add variable", section, variable?.id, "", saved);
      if (variable) content += removeForm(id, `/environment/${encodeURIComponent(variable.id)}/delete`, section, "Remove variable", `Remove ${variable.name} from new workspaces. Existing containers stay unchanged.`);
    } else {
      content = `${paragraph("Added to new workspace containers. Use Secrets for passwords and API keys.")}<div class="template-settings-toolbar"><span>${t.environment.length} ${t.environment.length === 1 ? "variable" : "variables"}</span>${navigation(id, section, "Add variable", "new")}</div><div class="action-list">${t.environment.map(v => record(id, section, v.id, v.name, v.value || "Empty value")).join("")}</div>${t.environment.length ? "" : paragraph("No environment variables yet.")}`;
    }
  } else if (section === "ssh") {
    if (editor) {
      const key = editor === "new" ? undefined : keys.find(k => k.id === editor);
      if (editor !== "new" && !key) throw invalidArguments("SSH key not found");
      title = key ? "Edit SSH key" : "Add SSH key";
      backSection = section;
      content = form(id, `/ssh-keys${key ? `/${encodeURIComponent(key.id)}` : ""}`, `${field("Name", "name", key?.name ?? "", 'autocomplete="off" autofocus')}${key ? "" : textarea("Private key", "privateKey", "", 7, 'required autocomplete="off" spellcheck="false"')}${paragraph("Private keys are encrypted outside workspaces. SSH key changes also apply to existing workspaces.")}`, key ? "Save changes" : "Add key", section, key?.id, "", saved);
      if (key) {
        const copy = transientFeedbackHtml({ element: { tag: "button", attributesHtml: 'type="button" data-action="ssh-public-key-copy#copy" aria-label="Copy public key"' }, initialContent: { kind: "text", text: "Copy public key" }, feedbackContent: { kind: "text", text: "Copied" }, state: "initial" });
        content += `<div class="template-settings-toolbar" data-controller="ssh-public-key-copy" data-ssh-public-key-copy-url-value="/workspace-templates/${encodeURIComponent(id)}/ssh-keys/${encodeURIComponent(key.id)}/public-key"><span>${escapeHtml(key.keyType)} · Public key</span>${copy}<span data-ssh-public-key-copy-target="error" role="status" hidden>Could not copy key</span></div>`;
        content += removeForm(id, `/ssh-keys/${encodeURIComponent(key.id)}/delete`, section, "Remove key", `Remove SSH key “${key.name || key.keyType}”. Connections relying on it may stop working.`);
      }
    } else {
      content = `${paragraph("Keys and trusted server identities for SSH connections. Changes also apply to existing workspaces.")}<div class="template-settings-toolbar"><span>${keys.length} ${keys.length === 1 ? "key" : "keys"}</span>${navigation(id, section, "Add key", "new")}</div><div class="action-list">${keys.map(k => record(id, section, k.id, k.name || "Unnamed key", "", `${k.keyType} · Stored`)).join("")}</div>${keys.length ? "" : paragraph("No SSH keys yet.")}<details${location.section === "ssh-keys" || focusRecord === "known-hosts" ? " open" : ""}><summary data-template-settings-record="known-hosts">Trusted SSH servers${knownHosts.trim() ? " · Configured" : " · None configured"}</summary>${form(id, "/ssh-known-hosts", `${paragraph("Paste known_hosts entries for servers you trust. Changing a server’s key requires trusting its new identity.")}${textarea("Known hosts", "knownHosts", knownHosts, 7, 'spellcheck="false"')}`, "Save changes", section, undefined, "", saved)}</details>`;
    }
  } else {
    content = paragraph("Container changes apply to new workspaces. Existing containers stay unchanged.");
    if (editor) {
      backSection = section;
      if (editor === "docker") {
        title = "Docker support";
        content += form(id, "/privileged", `${selection("Docker support", "privileged", String(t.privileged ?? false), [{ value: "false", label: "Off — stronger isolation" }, { value: "true", label: "On — privileged" }])}${paragraph("Privileged workspaces can access host devices and may read or modify host data. Enable only for projects and agents you trust.")}`, "Save changes", section, editor, "", saved);
      } else if (editor === "images") {
        title = "Preloaded images";
        content += t.privileged ? form(id, "/preload-images", `${paragraph("Loaded into new workspaces when Docker support is on.")}${textarea("Image references, one per line", "preloadImages", (t.preloadImages ?? []).join("\n"), 6, 'spellcheck="false" autofocus')}`, "Save changes", section, editor, "", saved) : `${paragraph("Turn on and save Docker support to edit preloaded images. Saved image references are kept while Docker is off.")}${textarea("Saved image references", "savedImages", (t.preloadImages ?? []).join("\n"), 4, "disabled")}${navigation(id, section, "Configure Docker support", "docker")}`;
      } else if (editor === "dockerfile") {
        title = "Custom Dockerfile";
        content += form(id, "/dockerfile", `${paragraph("An override takes precedence over .agents-in-the-cloud/Dockerfile in the repository. Leave blank to use the repository file, or the default image if there isn’t one.")}${textarea("Dockerfile override", "dockerfile", t.dockerfile ?? "", 14, 'spellcheck="false" placeholder="FROM agents-in-the-cloud-workspace" autofocus')}${paragraph("The first line must be FROM agents-in-the-cloud-workspace.")}`, "Save changes", section, editor, "", saved);
      } else throw invalidArguments("Unknown container editor");
    } else {
      content += `<div class="action-list">${record(id, section, "docker", "Docker support", "Isolation and Docker inside workspaces", t.privileged ? "On — privileged" : "Off")}${record(id, section, "images", "Preloaded images", t.privileged ? "Loaded into new workspaces" : "Requires Docker support · Saved references are retained", `${(t.preloadImages ?? []).length} configured`)}${record(id, section, "dockerfile", "Custom Dockerfile", "Repository file or template override", t.dockerfile?.trim() ? "Override configured" : "No override")}</div>`;
      if (t.privileged) content += paragraph("Docker support is on. Privileged workspaces can access host devices and may read or modify host data.");
    }
  }
  const back = section === "index" ? "" : actionLinkHtml({
    href: settingsUrl(id, backSection),
    variant: "secondary",
    content: { kind: "icon-only", iconHtml: Icons.Back, label: backSection === "index" ? "Back to template settings" : `Back to ${sections.find(([value]) => value === backSection)![1]}` },
    attributesHtml: `data-turbo-frame="${templateSettingsFrameId}"${editor ? ` data-template-settings-focus="${escapeHtml(editor)}"` : ""}`,
  });
  const header = `${back}<h1 class="panel__title" id="template_settings_title"${section === "index" ? "" : ' tabindex="-1" data-template-settings-heading'}>${section === "index" ? `${Icons.Settings}<span>Template settings · ${escapeHtml(t.name)}</span>` : escapeHtml(title)}</h1>${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: Icons.Close, label: "Close template settings" }, attributesHtml: 'data-action="template-settings#close"' })}`;
  const body = `<div class="template-settings-content" data-template-settings-location="${escapeHtml(settingsUrl(id, section, editor))}" data-template-settings-depth="${section === "index" ? 0 : editor ? 2 : 1}"${saved ? ' data-template-settings-saved="true"' : ""}${focusRecord ? ` data-template-settings-focus-record="${escapeHtml(focusRecord)}"` : ""}>
    <div id="template_settings_error"></div><div id="template_settings_request_error" hidden>${templateSettingsErrorHtml("Please try again. Your unsaved changes are still here.")}</div>${content}
  </div>`;
  return `<turbo-frame id="${templateSettingsFrameId}" data-template-settings-target="frame">${panelHtml({ element: { tag: "section", attributesHtml: 'aria-label="Template settings"' }, headerHtml: header, bodyHtml: body, bodyLayout: "full-bleed", bodyOverflow: "scroll" })}</turbo-frame>`;
}

export async function renderTemplateSettings(id: string, location: TemplateSettingsLocation, references: TemplateSettingsReference[]): Promise<string> {
  const t = await getWorkspaceTemplateConfiguration(id);
  const frame = await renderTemplateSettingsFrame(id, location, references);
  const guard = dialogHtml({ element: { id: "template_settings_discard", attributesHtml: 'data-template-settings-target="discard" data-action="cancel->template-settings#stay"' }, iconHtml: Icons.Settings, titleCaption: "Discard unsaved changes?", bodyHtml: paragraph("Your changes haven’t been saved."), omitCancelButton: true, footerHtml: `${captionButton("Stay", 'data-action="template-settings#stay"')}${captionButton("Discard changes", 'data-action="template-settings#discard"', "primary")}` });
  return `<div id="${templateSettingsHostId}" class="template-settings-host" data-controller="template-settings" data-template-settings-url-value="${escapeHtml(settingsUrl(id, sectionFor(location.section) ?? (t.secrets.some(secretNeedsValue) ? "secrets" : "index"), location.editor))}" data-action="turbo:frame-load->template-settings#loaded turbo:frame-missing->template-settings#frameMissing keydown->template-settings#keydown">
    ${frame}${guard}
  </div>`;
}
