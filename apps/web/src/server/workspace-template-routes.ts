import { AgentsInTheCloudCoreError, invalidArguments, readJsonObject, requestAcceptsJson, type JsonObject } from "@agents-in-the-cloud/core";
import { actionItemHtml } from "@agents-in-the-cloud/design-system/action-item";
import { actionLinkHtml } from "@agents-in-the-cloud/design-system/action-link";
import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { destructiveConfirmationHtml } from "@agents-in-the-cloud/design-system/destructive-confirmation";
import { dialogHtml } from "@agents-in-the-cloud/design-system/dialog";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { toggleHtml } from "@agents-in-the-cloud/design-system/toggle";
import { transientFeedbackHtml } from "@agents-in-the-cloud/design-system/transient-feedback";
import { warningBannerHtml } from "@agents-in-the-cloud/design-system/warning-banner";
import {
  addWorkspaceTemplate, createWorkspaceTemplateEnvironmentVariable,
  createWorkspaceTemplateSecret,
  createWorkspaceTemplateSshKey,
  deleteWorkspaceTemplate, deleteWorkspaceTemplateEnvironmentVariable, deleteWorkspaceTemplateSecret, deleteWorkspaceTemplateSshKey, deriveWorkspaceTemplateSshPublicKey,
  formatWorkspaceTemplateSpec, getWorkspaceTemplateConfiguration,
  getWorkspaceTemplateSshKnownHosts,
  listWorkspaceTemplateEnvironmentVariables, listWorkspaceTemplateSecrets,
  listWorkspaceTemplateSshKeys, listWorkspaceTemplates, parseWorkspaceTemplateSpec, renameWorkspaceTemplateSshKey,
  secretNeedsValue, workspaceTemplateSecretAllowsPath, workspaceTemplateSecretPathPermissionSchema,
  setWorkspaceTemplateDockerfile, setWorkspaceTemplatePreloadImages, setWorkspaceTemplatePrivileged,
  setWorkspaceTemplateSshKnownHosts,
  updateWorkspaceTemplate,
  updateWorkspaceTemplateEnvironmentVariable, updateWorkspaceTemplateSecret,
  type WorkspaceTemplateConfiguration, type WorkspaceTemplateEnvironmentVariable, type WorkspaceTemplateSecretInput, type WorkspaceTemplateSecretSummary, type WorkspaceTemplateSshKeySummary, type WorkspaceTemplateSummary,
} from "@agents-in-the-cloud/workspace-templates";
import { publicInstanceUrl } from "@agents-in-the-cloud/proxy-ingress";
import { domId, escapeHtml, turboStreamResponse } from "@agents-in-the-cloud/shared";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { GitHubRepositorySearchRateLimitError, renderGitHubRepositorySearchMenu, renderGitHubRepositorySearchRateLimitMenu, searchGitHubRepositories, shouldSearchGitHubRepositories } from "./github-repo-search.ts";
import { instanceUrlHtml } from "./instance-url.ts";
import { jsonResponse, matchRoute, replace, response, textResponse, update, wantsStream } from "@agents-in-the-cloud/shared/http";

const jsonStringSchema = Type.String();
const jsonBooleanSchema = Type.Boolean();

export type WorkspaceTemplateEditorModalOptions =
  | { kind: "settings"; workspaceTemplateId: string; section: string | undefined }
  | { kind: "new" };

export interface WorkspaceTemplateRoutes {
  handle(request: Request, url: URL): Promise<Response | undefined>;
  byReference(reference: string): Promise<WorkspaceTemplateSummary>;
  editorModal(options: WorkspaceTemplateEditorModalOptions, request: Request): Promise<string>;
}

interface WorkspaceTemplateWorkspaceReference {
  workspaceId: string;
  title: string;
}

export function createWorkspaceTemplateRoutes(deps: {
  referencingWorkspaces(workspaceTemplateId: string): WorkspaceTemplateWorkspaceReference[];
  invalidatePresentation(): void;
  createAgentWorkspace(workspaceTemplate: WorkspaceTemplateSummary, request: Request): Promise<Response>;
}): WorkspaceTemplateRoutes {
  function workspaceTemplateEnvironmentRow(workspaceTemplate: WorkspaceTemplateSummary, variable: WorkspaceTemplateEnvironmentVariable): string {
    const removeButton = destructiveConfirmationHtml({
      id: domId("remove_environment", workspaceTemplate.id, variable.id),
      trigger: {
        type: "button",
        variant: "danger",
        content: { kind: "icon-only", iconHtml: Icons.Close, label: "Remove environment variable" },
      },
      confirmCaption: "Remove variable",
      cancelCaption: "Cancel",
      confirmFormAction: `/workspace-templates/${encodeURIComponent(workspaceTemplate.id)}/environment/${encodeURIComponent(variable.id)}/delete`,
    });
    return `<form class="workspace-template-configuration-row workspace-template-environment-row" method="post" action="/workspace-templates/${encodeURIComponent(workspaceTemplate.id)}/environment/${encodeURIComponent(variable.id)}" data-turbo="true" data-controller="settings-autosave" data-action="focusout->settings-autosave#saveWhenLeaving">
    <input class="text-field" name="name" value="${escapeHtml(variable.name)}" aria-label="Name" autocomplete="off">
    <input class="text-field" name="value" value="${escapeHtml(variable.value)}" aria-label="Value" autocomplete="off">
    <span class="workspace-template-configuration-actions">${removeButton}</span>
  </form>`;
  }

  function workspaceTemplateEnvironmentFields(workspaceTemplate: WorkspaceTemplateSummary, environment: WorkspaceTemplateEnvironmentVariable[]): string {
    return `<div class="workspace-template-configuration-grid" id="${domId("workspace_template_environment_fields", workspaceTemplate.id)}" aria-label="Environment variables">
      ${environment.map((variable) => workspaceTemplateEnvironmentRow(workspaceTemplate, variable)).join("")}
      <form class="workspace-template-configuration-row workspace-template-environment-row new" method="post" action="/workspace-templates/${encodeURIComponent(workspaceTemplate.id)}/environment" data-turbo="true" data-controller="settings-autosave" data-action="focusout->settings-autosave#saveWhenLeaving submit->settings-autosave#submit">
        <input class="text-field" name="name" placeholder="TELEGRAM_CHANNEL_ID" aria-label="Name" autocomplete="off" required>
        <input class="text-field" name="value" placeholder="-1001234567890" aria-label="Value" autocomplete="off">
        <span></span>
      </form>
    </div>`;
  }

  function workspaceTemplateConfigurationDisclosure(label: string, fieldsHtml: string, open = false): string {
    const summary = actionItemHtml({ kind: "single", label: { kind: "text", text: label }, leadingHtml: Icons.Disclosure, element: { tag: "summary" } });
    return `<details class="workspace-template-configuration-disclosure"${open ? " open" : ""}>${summary}${fieldsHtml}</details>`;
  }

  function revealSection(section: WorkspaceTemplateSettingsSection | undefined, current: WorkspaceTemplateSettingsSection): string {
    return section === current ? ' data-controller="scroll-into-view"' : "";
  }

  function workspaceTemplateEnvironmentEditor(workspaceTemplate: WorkspaceTemplateSummary, environment: WorkspaceTemplateEnvironmentVariable[], section?: WorkspaceTemplateSettingsSection): string {
    return `<section class="workspace-template-configuration-list workspace-template-environment" id="${domId("workspace_template_environment", workspaceTemplate.id)}"${revealSection(section, "environment")}>
      <div class="workspace-template-configuration-head"><h3>Environment variables</h3><p>These variables are added to every new workspace container created from this template.</p></div>
      ${workspaceTemplateConfigurationDisclosure("Configure environment variables", workspaceTemplateEnvironmentFields(workspaceTemplate, environment), section === "environment")}
    </section>`;
  }

  function workspaceTemplatePrivilegeEditor(workspaceTemplate: WorkspaceTemplateSummary, section?: WorkspaceTemplateSettingsSection): string {
    return `<section class="workspace-template-configuration-list" id="${domId("workspace_template_privileged", workspaceTemplate.id)}"${revealSection(section, "privileged")}>
      <div class="workspace-template-configuration-head"><h3>Docker support &amp; isolation</h3><p>Privileged mode enables Docker inside workspaces, at the cost of isolation from the host. Workspace agents can access host devices and may read or modify host data. Leave it off unless you need Docker and trust the project and its agents.</p><p>Off by default. Changes apply to new workspaces only; recreate existing workspaces to change their privileges.</p></div>
      ${toggleHtml({ variant: "button", label: "Privileged mode", name: "privileged", value: String(workspaceTemplate.privileged ?? false), options: [{ value: "false", label: "Off — stronger isolation" }, { value: "true", label: "On — Docker support" }], form: { action: `/workspace-templates/${encodeURIComponent(workspaceTemplate.id)}/privileged`, method: "post", turbo: true } })}
    </section>`;
  }

  function workspaceTemplateDockerfileEditor(workspaceTemplate: WorkspaceTemplateSummary, section?: WorkspaceTemplateSettingsSection): string {
    const example = [
      "FROM agents-in-the-cloud-workspace",
      "",
      "# Build against PostgreSQL and connect to your development database",
      "RUN apt-get update \\",
      " && apt-get install -y --no-install-recommends \\",
      "      libpq-dev \\",
      "      postgresql-client \\",
      " && rm -rf /var/lib/apt/lists/*",
      "",
      "WORKDIR /work",
    ].join("\n");
    const fields = `<div class="workspace-template-dockerfile-form">
      <div class="workspace-template-configuration-head"><p>You may paste your dockerfile here or commit it at <code>.agents-in-the-cloud/Dockerfile</code> so others can use it too.</p></div>
      <form method="post" action="/workspace-templates/${encodeURIComponent(workspaceTemplate.id)}/dockerfile" data-turbo="true" data-controller="settings-autosave" data-action="focusout->settings-autosave#saveWhenLeaving">
        <textarea class="textarea" aria-label="Custom Dockerfile" name="dockerfile" rows="12" spellcheck="false" autocomplete="off" placeholder="${escapeHtml(example)}">${escapeHtml(workspaceTemplate.dockerfile ?? "")}</textarea>
      </form>
    </div>`;
    return `<section class="workspace-template-configuration-list" id="${domId("workspace_template_dockerfile", workspaceTemplate.id)}"${revealSection(section, "dockerfile")}>
      <div class="workspace-template-configuration-head"><h3>Custom dockerfile</h3><p>Use a <code>./.agents-in-the-cloud/Dockerfile</code> to install the system dependencies this template’s workspaces need.</p></div>
      ${workspaceTemplateConfigurationDisclosure("Custom Dockerfile", fields, section === "dockerfile")}
    </section>`;
  }

  function workspaceTemplatePreloadImagesEditor(workspaceTemplate: WorkspaceTemplateSummary, section?: WorkspaceTemplateSettingsSection): string {
    const fields = `<form method="post" action="/workspace-templates/${encodeURIComponent(workspaceTemplate.id)}/preload-images" data-turbo="true" data-controller="settings-autosave" data-action="focusout->settings-autosave#saveWhenLeaving">
      <label><span>Image references, one per line</span><textarea class="textarea" name="preloadImages" rows="4" spellcheck="false" autocomplete="off" placeholder="docker.io/library/postgres:17">${escapeHtml((workspaceTemplate.preloadImages ?? []).join("\n"))}</textarea></label>
    </form>`;
    return `<section class="workspace-template-configuration-list" id="${domId("workspace_template_preload_images", workspaceTemplate.id)}"${revealSection(section, "preload-images")}>
      <div class="workspace-template-configuration-head"><h3>Preloaded Docker images</h3><p>Images are preloaded into new workspaces only when Docker support is on.</p></div>
      ${workspaceTemplateConfigurationDisclosure("Configure preloaded images", fields, section === "preload-images")}
    </section>`;
  }

  function secretRequirementToggle(optional: boolean): string {
    return `<div class="workspace-template-secret-requirement"><span>Requirement</span><input type="hidden" name="optional" value="${optional}">${toggleHtml({
      variant: "button",
      label: "Secret requirement",
      name: "optional",
      value: String(optional),
      options: [{ value: "false", label: "Mandatory" }, { value: "true", label: "Optional" }],
      element: { dataAction: "change->settings-autosave#toggleChanged" },
    })}</div>`;
  }

  function workspaceTemplateSecretRow(workspaceTemplate: WorkspaceTemplateSummary, secret?: WorkspaceTemplateSecretSummary): string {
    const allowInPath = secret ? workspaceTemplateSecretAllowsPath(secret) : undefined;
    const secretPath = `/workspace-templates/${encodeURIComponent(workspaceTemplate.id)}/secrets${secret ? `/${encodeURIComponent(secret.id)}` : ""}`;
    const deleteButton = secret ? destructiveConfirmationHtml({
      id: domId("delete_secret", workspaceTemplate.id, secret.id),
      trigger: { type: "button", variant: "danger", content: { kind: "caption", caption: "Delete secret" } },
      confirmCaption: "Delete secret",
      cancelCaption: "Cancel",
      confirmFormAction: `${secretPath}/delete`,
    }) : "";
    const status = secret?.configured
      ? '<p class="workspace-template-secret-saved" role="status">✓ Secret stored</p>'
      : secret && secretNeedsValue(secret) ? warningBannerHtml({ title: "Mandatory secret — needs a value" }) : "";
    return `<form class="workspace-template-secret${secret ? "" : " new"}" aria-label="${secret ? "Secret" : "Add secret"}" method="post" action="${secretPath}" data-turbo="true" data-controller="settings-autosave${secret ? "" : " workspace-template-secret-path"}" data-action="focusout->settings-autosave#saveWhenLeaving${secret ? "" : " submit->settings-autosave#submit"}">
      ${status}
      <label><span>Environment variable</span><input class="text-field" name="envName" value="${escapeHtml(secret?.envName ?? "")}" placeholder="GOOGLE_MAPS_API_KEY" autocomplete="off"${secret ? "" : " required"}></label>
      <label><span>Host</span><input class="text-field" name="hostPattern" value="${escapeHtml(secret?.hostPattern ?? "")}" placeholder="maps.googleapis.com" autocomplete="off"${secret ? "" : ' required data-workspace-template-secret-path-target="host" data-action="input->workspace-template-secret-path#useDefault"'}></label>
      <div class="workspace-template-secret-requirement"><span>URL paths ${buttonHtml({ type: "button", variant: "secondary", content: { kind: "icon-only", iconHtml: "?", label: "Only set to Allow if you need to have this secret injected into the URL path instead of in the headers" } })}</span><input type="hidden" name="allowInPath" value="${allowInPath ?? false}"${secret ? "" : ' data-workspace-template-secret-path-target="permission"'}>${toggleHtml({
        variant: "button",
        label: "Allow secret in URL paths",
        name: "allowInPath",
        value: String(allowInPath ?? false),
        options: [{ value: "true", label: "Allow" }, { value: "false", label: "Disallow" }],
        element: {
          dataAction: `${secret ? "" : "click->workspace-template-secret-path#choose change->workspace-template-secret-path#choose "}change->settings-autosave#toggleChanged`,
          data: secret ? undefined : { "workspace-template-secret-path-target": "toggle" },
        },
      })}</div>
      <label><span>Secret</span><input class="text-field" name="secretValue" type="password" data-1p-ignore data-action="change->settings-autosave#save" placeholder="${secret?.configured ? "Secret stored — leave blank to keep it" : "No secret stored — enter a value"}" autocomplete="new-password"></label>
      <label><span>Placeholder</span><input class="text-field" name="placeholder" value="${escapeHtml(secret?.placeholder ?? "")}" placeholder="You rarely need to fill this in" autocomplete="off"></label>
      <label><span>Needed for</span><textarea class="textarea" name="annotation" rows="2" placeholder="For example, running payment integration tests">${escapeHtml(secret?.annotation ?? "")}</textarea></label>
      ${secretRequirementToggle(secret?.optional ?? false)}
      ${deleteButton ? `<div class="workspace-template-secret-actions">${deleteButton}</div>` : ""}
    </form>`;
  }

  function workspaceTemplateSecretFields(workspaceTemplate: WorkspaceTemplateSummary, secrets: WorkspaceTemplateSecretSummary[]): string {
    const requiredFirst = secrets.toSorted((a, b) => Number(secretNeedsValue(b)) - Number(secretNeedsValue(a)));
    return `<div class="workspace-template-secrets-list" id="${domId("workspace_template_secret_fields", workspaceTemplate.id)}" aria-label="Secrets">
      ${requiredFirst.map((secret) => workspaceTemplateSecretRow(workspaceTemplate, secret)).join("")}
      ${workspaceTemplateSecretRow(workspaceTemplate)}
    </div>`;
  }

  function collapsedSecretWarning(workspaceTemplate: WorkspaceTemplateSummary, secrets: WorkspaceTemplateSecretSummary[]): string {
    return `<div class="workspace-template-secrets-collapsed-warning" id="${domId("workspace_template_secret_warning", workspaceTemplate.id)}">${secrets.some(secretNeedsValue) ? warningBannerHtml({ title: "Mandatory secret — needs a value" }) : ""}</div>`;
  }

  function workspaceTemplateSecretEditor(workspaceTemplate: WorkspaceTemplateSummary, secrets: WorkspaceTemplateSecretSummary[], section?: WorkspaceTemplateSettingsSection): string {
    return `<section class="workspace-template-configuration-list workspace-template-secrets" id="${domId("workspace_template_secrets", workspaceTemplate.id)}"${revealSection(section, "secrets")}>
      <div class="workspace-template-configuration-head"><h3>Secrets</h3><p>Secrets let your agents connect to services without seeing your passwords or API keys.</p><p>Agents see a placeholder. AgentsInTheCloud intercepts network requests to services you specify and replaces the placeholder with the real secret.</p></div>
      ${collapsedSecretWarning(workspaceTemplate, secrets)}
      ${workspaceTemplateConfigurationDisclosure("Configure secrets", workspaceTemplateSecretFields(workspaceTemplate, secrets), section === "secrets" || secrets.some(secretNeedsValue))}
    </section>`;
  }

  function workspaceTemplateSshKeyFields(workspaceTemplate: WorkspaceTemplateSummary, keys: WorkspaceTemplateSshKeySummary[]): string {
    const workspaceTemplatePath = `/workspace-templates/${encodeURIComponent(workspaceTemplate.id)}`;
    const configuredKeys = keys.map((key) => {
      const removeButton = destructiveConfirmationHtml({
        id: domId("remove_ssh_key", workspaceTemplate.id, key.id),
        trigger: { type: "button", variant: "danger", content: { kind: "icon-only", iconHtml: Icons.Close, label: "Remove SSH key" } },
        confirmCaption: "Remove SSH key",
        cancelCaption: "Cancel",
      });
      const keyPath = `${workspaceTemplatePath}/ssh-keys/${encodeURIComponent(key.id)}`;
      const copyButton = transientFeedbackHtml({
        element: { tag: "button", attributesHtml: `type="button" aria-label="Copy public key" data-action="click->ssh-public-key-copy#copy"` },
        initialContent: { kind: "text", text: "Copy" },
        feedbackContent: { kind: "text", text: "Copied" },
        state: "initial",
      });
      return `<div class="workspace-template-ssh-key-configured"><div class="workspace-template-ssh-key-heading"><form method="post" action="${keyPath}" data-turbo="true" data-controller="settings-autosave" data-action="focusout->settings-autosave#saveWhenLeaving"><label><span>Name</span><input class="text-field" name="name" aria-label="SSH key name" placeholder="Name this key" value="${escapeHtml(key.name ?? "")}" autocomplete="off"></label></form><form method="post" action="${keyPath}/delete" data-turbo="true">${removeButton}</form></div><div class="workspace-template-ssh-key-public" data-controller="ssh-public-key-copy" data-ssh-public-key-copy-url-value="${keyPath}/public-key"><span>Public key</span><code>${escapeHtml(key.keyType)} …</code>${copyButton}<span class="workspace-template-ssh-key-copy-error" data-ssh-public-key-copy-target="error" role="status" hidden>Could not copy key</span></div></div>`;
    }).join("");
    return `<div class="workspace-template-ssh-key-fields" id="${domId("workspace_template_ssh_key_fields", workspaceTemplate.id)}"><div class="workspace-template-ssh-key-list">${configuredKeys}</div><form class="workspace-template-ssh-key-form" method="post" action="${workspaceTemplatePath}/ssh-keys" data-turbo="true">
      <h4>Add a key</h4>
      <input class="text-field" name="name" aria-label="New SSH key name" placeholder="Name (optional)" autocomplete="off">
      <textarea class="textarea" name="privateKey" aria-label="Private key" placeholder="Paste private key" autocomplete="off" spellcheck="false" required></textarea>
      <div class="workspace-template-ssh-key-form-footer"><span>Encrypted outside workspaces</span>${buttonHtml({ type: "submit", variant: "secondary", content: { kind: "caption", caption: "Add key" } })}</div>
    </form></div>`;
  }

  function workspaceTemplateSshHostTrustFields(workspaceTemplateId: string, knownHosts: string): string {
    return `<form id="${domId("workspace_template_ssh_host_trust", workspaceTemplateId)}" class="workspace-template-ssh-key-fields workspace-template-ssh-key-form" method="post" action="/workspace-templates/${encodeURIComponent(workspaceTemplateId)}/ssh-known-hosts" data-turbo="true" data-controller="settings-autosave" data-action="focusout->settings-autosave#saveWhenLeaving submit->settings-autosave#submit">
      <label><span>Additional servers</span><textarea class="textarea" name="knownHosts" placeholder="git.example.com ssh-ed25519 AAAA…" spellcheck="false">${escapeHtml(knownHosts)}</textarea></label>
      <p>GitHub is trusted automatically. Verify other servers’ known_hosts entries with your administrator. Applies to new workspaces.</p>
    </form>`;
  }

  function workspaceTemplateSshKeyEditor(workspaceTemplate: WorkspaceTemplateSummary, keys: WorkspaceTemplateSshKeySummary[], knownHosts: string, section?: WorkspaceTemplateSettingsSection): string {
    return `<section class="workspace-template-configuration-list workspace-template-ssh-key" id="${domId("workspace_template_ssh_key", workspaceTemplate.id)}"${revealSection(section, "ssh-keys")}>
      ${workspaceTemplateConfigurationDisclosure("SSH keys", workspaceTemplateSshKeyFields(workspaceTemplate, keys), section === "ssh-keys")}
      ${workspaceTemplateConfigurationDisclosure("Trusted SSH servers", workspaceTemplateSshHostTrustFields(workspaceTemplate.id, knownHosts))}
    </section>`;
  }

  function workspaceTemplateDeleteControl(workspaceTemplateId: string, references: WorkspaceTemplateWorkspaceReference[] = []): string {
    const confirmation = destructiveConfirmationHtml({
      id: domId("delete_workspace_template", workspaceTemplateId),
      trigger: { type: "button", variant: "danger", content: { kind: "caption", caption: "Delete template" } },
      confirmCaption: "Delete template",
      cancelCaption: "Cancel",
    });
    const form = `<form method="post" action="/workspace-templates/${encodeURIComponent(workspaceTemplateId)}/delete" data-turbo="true" data-action="turbo:submit-end->dialog#submitted">${confirmation}</form>`;
    const feedback = references.length === 1
      ? `Delete workspace “${references[0]!.title}” first`
      : `Delete ${references.length} workspaces first`;
    return transientFeedbackHtml({
      element: { tag: "div", attributesHtml: `id="${domId("workspace_template_delete_control", workspaceTemplateId)}"` },
      initialContent: { kind: "html", html: form },
      feedbackContent: { kind: "html", html: `<span class="transient-feedback__status">${escapeHtml(feedback)}</span>` },
      state: references.length > 0 ? "feedback" : "initial",
    });
  }

  type WorkspaceTemplateSettingsSection = "repository" | "secrets" | "ssh-keys" | "environment" | "dockerfile" | "preload-images" | "privileged" | "danger";

  function parseWorkspaceTemplateSettingsSection(value: string | undefined): WorkspaceTemplateSettingsSection | undefined {
    if (value === undefined) return undefined;
    if (value === "repository" || value === "secrets" || value === "ssh-keys" || value === "environment" || value === "dockerfile" || value === "preload-images" || value === "privileged" || value === "danger") return value;
    throw invalidArguments("section must be one of: repository, secrets, ssh-keys, environment, dockerfile, preload-images, privileged, danger");
  }

  async function workspaceTemplateEditorBody(workspaceTemplate: WorkspaceTemplateConfiguration, instanceUrl: string, section?: WorkspaceTemplateSettingsSection): Promise<string> {
    const { environment, secrets } = workspaceTemplate;
    const [sshKeys, knownHosts] = await Promise.all([listWorkspaceTemplateSshKeys(workspaceTemplate.id), getWorkspaceTemplateSshKnownHosts(workspaceTemplate.id)]);
    if (section === undefined && secrets.some(secretNeedsValue)) section = "secrets";
    return `<div id="workspace_template_editor_body" class="workspace-template-editor-body">
      <div class="workspace-template-editor-page workspace-template-editor-detail-page">
        <div class="workspace-template-editor-detail-body">
          <section class="workspace-template-edit-section"${revealSection(section, "repository")}><form class="workspace-template-edit-form" aria-label="Repository" method="post" action="/workspace-templates/${encodeURIComponent(workspaceTemplate.id)}" data-controller="settings-autosave" data-action="change->settings-autosave#save"><label class="workspace-template-edit-field"><span>Display name</span><input class="text-field" name="name" value="${escapeHtml(workspaceTemplate.name)}" required></label><label class="workspace-template-edit-field"><span>Repository</span><input class="text-field" name="gitUrl" value="${escapeHtml(formatWorkspaceTemplateSpec(workspaceTemplate))}" required></label></form></section>
          <div class="workspace-template-edit-config">${workspaceTemplateSecretEditor(workspaceTemplate, secrets, section)}${workspaceTemplateSshKeyEditor(workspaceTemplate, sshKeys, knownHosts, section)}${workspaceTemplateEnvironmentEditor(workspaceTemplate, environment, section)}${workspaceTemplateDockerfileEditor(workspaceTemplate, section)}${workspaceTemplatePreloadImagesEditor(workspaceTemplate, section)}${workspaceTemplatePrivilegeEditor(workspaceTemplate, section)}</div>
          <section class="workspace-template-edit-danger-zone"${revealSection(section, "danger")}>${workspaceTemplateConfigurationDisclosure("Danger zone", `<div class="workspace-template-edit-danger">${workspaceTemplateDeleteControl(workspaceTemplate.id)}</div>`, section === "danger")}</section>
          <section class="workspace-template-configuration-list">
            <div class="workspace-template-configuration-head"><h3>AgentsInTheCloud instance URL</h3><p>The external URL for this AgentsInTheCloud instance.</p></div>
            ${instanceUrlHtml(instanceUrl, "workspace_template_instance_url_qr")}
          </section>
        </div>
      </div>
    </div>`;
  }

  function newWorkspaceTemplateEditorBody(): string {
    const cancelButton = buttonHtml({ type: "button", variant: "secondary", content: { kind: "caption", caption: "Cancel" }, attributesHtml: 'data-action="dialog#close"' });
    const addButton = buttonHtml({ type: "submit", variant: "primary", content: { kind: "caption", caption: "Add template" }, attributesHtml: 'data-turbo-submits-with="Adding…"' });
    return `<div id="workspace_template_editor_body" class="workspace-template-editor-body"><div class="workspace-template-editor-page workspace-template-editor-detail-page"><form class="workspace-template-editor-new-form" aria-label="Add template" method="post" action="/workspace-templates" data-turbo="true" data-action="turbo:submit-end->dialog#submitted"><div><p>Save a remote URL, local path, or search for a GitHub repository.</p><div data-controller="workspace-template-github-search" data-workspace-template-github-search-url-value="/workspace-templates/github-search"><input class="text-field" name="gitUrl" placeholder="github.com/org/repo, or /path/to/repo#branch" required autofocus data-workspace-template-github-search-target="input" data-action="keydown->workspace-template-github-search#keydown input->workspace-template-github-search#input"><div class="floating-surface autocomplete-popover workspace-template-github-results" data-workspace-template-github-search-target="menu" hidden></div></div></div><footer>${cancelButton}${addButton}</footer></form></div></div>`;
  }

  async function workspaceTemplateEditorModal(options: WorkspaceTemplateEditorModalOptions, request: Request): Promise<string> {
    const title = options.kind === "new" ? "Add a template" : "Template settings";
    const bodyHtml = options.kind === "new"
      ? newWorkspaceTemplateEditorBody()
      : await workspaceTemplateEditorBody(await getWorkspaceTemplateConfiguration(options.workspaceTemplateId), publicInstanceUrl(request), parseWorkspaceTemplateSettingsSection(options.section));
    return dialogHtml({
      element: {
        id: "workspace-template-editor-modal",
        attributesHtml: `data-dialog-auto-show${options.kind === "new" ? "" : ' data-controller="workspace-template-settings" data-action="settings-autosave:saving->workspace-template-settings#saving settings-autosave:saved->workspace-template-settings#saved settings-autosave:failed->workspace-template-settings#failed"'}`,
      },
      iconHtml: Icons.Settings,
      titleCaption: title,
      bodyHtml,
      bodyLayout: "full-bleed",
      footerHtml: options.kind === "new" ? undefined : `<span class="workspace-template-settings-save-status" role="status" data-workspace-template-settings-target="status">Changes save automatically.</span>${buttonHtml({ type: "button", variant: "primary", content: { kind: "caption", caption: "OK" }, attributesHtml: 'data-action="workspace-template-settings#complete" data-workspace-template-settings-target="confirm"' })}`,
      closeLabel: `Close ${title.toLowerCase()}`,
    });
  }

  async function workspaceTemplateById(id: string): Promise<WorkspaceTemplateSummary> {
    const { workspaceTemplates } = await listWorkspaceTemplates();
    const workspaceTemplate = workspaceTemplates.find((candidate) => candidate.id === id);
    if (!workspaceTemplate) throw new AgentsInTheCloudCoreError("workspace_template_not_found", `template not found: ${id}`);
    return workspaceTemplate;
  }

  function jsonString(body: JsonObject, field: string): string {
    const value = body[field];
    if (!Value.Check(jsonStringSchema, value)) throw invalidArguments(`${field} is required`);
    return value;
  }

  function requiredJsonString(body: JsonObject, field: string): string {
    const value = jsonString(body, field);
    if (!value.trim()) throw invalidArguments(`${field} is required`);
    return value;
  }

  function optionalJsonString(body: JsonObject, field: string): string | undefined {
    const value = body[field];
    if (value === undefined) return undefined;
    if (!Value.Check(jsonStringSchema, value)) throw invalidArguments(`${field} must be a string`);
    return value;
  }

  async function workspaceTemplateDetailEndpoint(workspaceTemplateId: string): Promise<Response> {
    return jsonResponse({ workspaceTemplate: await getWorkspaceTemplateConfiguration(workspaceTemplateId) });
  }

  async function createWorkspaceTemplateEndpoint(request: Request, url: URL): Promise<Response> {
    const json = requestAcceptsJson(request);
    const gitUrl = json
      ? requiredJsonString(await readJsonObject(request), "gitUrl")
      : String((await request.formData()).get("gitUrl") ?? "");
    let workspaceTemplate: WorkspaceTemplateSummary;
    try {
      workspaceTemplate = (await addWorkspaceTemplate(gitUrl)).workspaceTemplate;
    } catch (error) {
      if (!(error instanceof AgentsInTheCloudCoreError && error.code === "workspace_template_exists")) throw error;
      const specification = parseWorkspaceTemplateSpec(gitUrl);
      const workspaceTemplates = (await listWorkspaceTemplates()).workspaceTemplates;
      workspaceTemplate = workspaceTemplates.find((candidate) => candidate.gitUrl === specification.gitUrl && candidate.branch === specification.branch)!;
    }
    deps.invalidatePresentation();
    if (json) return jsonResponse({ workspaceTemplate });
    // Adding a template returns to the template picker, where the new template is selected.
    if (wantsStream(request)) return turboStreamResponse(replace("workspace-template-editor-modal", '<div id="workspace-template-editor-modal"></div>'));
    return Response.redirect(new URL("/", url).toString(), 303);
  }

  async function updateWorkspaceTemplateEndpoint(workspaceTemplateId: string, request: Request): Promise<Response> {
    const json = requestAcceptsJson(request);
    let name: string;
    let spec: string;
    if (json) {
      const body = await readJsonObject(request);
      name = requiredJsonString(body, "name");
      spec = requiredJsonString(body, "gitUrl");
    } else {
      const formData = await request.formData();
      name = String(formData.get("name") ?? "");
      spec = String(formData.get("gitUrl") ?? "");
    }
    const { workspaceTemplate } = await updateWorkspaceTemplate(workspaceTemplateId, { name, spec });
    deps.invalidatePresentation();
    return workspaceTemplateSettingsResponse(request, { workspaceTemplate }, async () => "");
  }

  type WorkspaceTemplateSettingsResult = { knownHosts: string } | { workspaceTemplate: WorkspaceTemplateSummary } | { secret: WorkspaceTemplateSecretSummary; deleted?: true } | { environmentVariable: WorkspaceTemplateEnvironmentVariable; deleted?: true } | { key: WorkspaceTemplateSshKeySummary };

  /** Every settings mutation refreshes workspace warnings, including JSON callers. */
  async function workspaceTemplateSettingsResponse(request: Request, result: WorkspaceTemplateSettingsResult, renderFields: () => Promise<string> = async () => ""): Promise<Response> {
    deps.invalidatePresentation();
    return requestAcceptsJson(request) ? jsonResponse(result) : turboStreamResponse(`${await renderFields()}`);
  }

  async function updateWorkspaceTemplatePrivilegeEndpoint(workspaceTemplateId: string, request: Request): Promise<Response> {
    let privileged: boolean;
    if (requestAcceptsJson(request)) {
      const body = await readJsonObject(request);
      if (!Value.Check(jsonBooleanSchema, body.privileged)) throw invalidArguments("privileged must be a boolean");
      privileged = body.privileged;
    } else {
      const value = (await request.formData()).get("privileged");
      if (value !== "true" && value !== "false") throw invalidArguments("privileged must be true or false");
      privileged = value === "true";
    }
    const result = await setWorkspaceTemplatePrivileged(workspaceTemplateId, privileged);
    return workspaceTemplateSettingsResponse(request, result, async () => replace(domId("workspace_template_privileged", workspaceTemplateId), workspaceTemplatePrivilegeEditor(result.workspaceTemplate)));
  }

  async function updateWorkspaceTemplateDockerfileEndpoint(workspaceTemplateId: string, request: Request): Promise<Response> {
    const json = requestAcceptsJson(request);
    const dockerfile = json ? jsonString(await readJsonObject(request), "dockerfile") : String((await request.formData()).get("dockerfile") ?? "");
    const result = await setWorkspaceTemplateDockerfile(workspaceTemplateId, dockerfile);
    return workspaceTemplateSettingsResponse(request, result);
  }

  async function updateWorkspaceTemplatePreloadImagesEndpoint(workspaceTemplateId: string, request: Request): Promise<Response> {
    let images: string[];
    if (requestAcceptsJson(request)) {
      const body = await readJsonObject(request);
      if (!Value.Check(Type.Array(Type.String()), body.preloadImages)) throw invalidArguments("preloadImages must be an array of image references");
      images = body.preloadImages;
    } else {
      const form = await request.formData();
      images = String(form.get("preloadImages") ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }
    const result = await setWorkspaceTemplatePreloadImages(workspaceTemplateId, images);
    return requestAcceptsJson(request) ? jsonResponse(result) : turboStreamResponse("");
  }

  async function renderWorkspaceTemplateEnvironmentStreams(workspaceTemplateId: string): Promise<string> {
    const workspaceTemplate = await workspaceTemplateById(workspaceTemplateId);
    return replace(domId("workspace_template_environment_fields", workspaceTemplateId), workspaceTemplateEnvironmentFields(workspaceTemplate, await listWorkspaceTemplateEnvironmentVariables(workspaceTemplateId)));
  }

  async function workspaceTemplateEnvironmentVariableValues(request: Request): Promise<{ name: string; value: string }> {
    if (!requestAcceptsJson(request)) {
      const formData = await request.formData();
      return { name: String(formData.get("name") ?? ""), value: String(formData.get("value") ?? "") };
    }
    const body = await readJsonObject(request);
    return { name: requiredJsonString(body, "name"), value: jsonString(body, "value") };
  }

  async function createWorkspaceTemplateEnvironmentVariableEndpoint(workspaceTemplateId: string, request: Request): Promise<Response> {
    const environmentVariable = await createWorkspaceTemplateEnvironmentVariable(workspaceTemplateId, await workspaceTemplateEnvironmentVariableValues(request));
    return workspaceTemplateSettingsResponse(request, { environmentVariable }, () => renderWorkspaceTemplateEnvironmentStreams(workspaceTemplateId));
  }

  async function updateWorkspaceTemplateEnvironmentVariableEndpoint(workspaceTemplateId: string, variableId: string, request: Request): Promise<Response> {
    const environmentVariable = await updateWorkspaceTemplateEnvironmentVariable(workspaceTemplateId, variableId, await workspaceTemplateEnvironmentVariableValues(request));
    return workspaceTemplateSettingsResponse(request, { environmentVariable }, () => renderWorkspaceTemplateEnvironmentStreams(workspaceTemplateId));
  }

  async function deleteWorkspaceTemplateEnvironmentVariableEndpoint(workspaceTemplateId: string, variableId: string, request: Request): Promise<Response> {
    if (requestAcceptsJson(request)) await readJsonObject(request);
    const environmentVariable = await deleteWorkspaceTemplateEnvironmentVariable(workspaceTemplateId, variableId);
    return workspaceTemplateSettingsResponse(request, { deleted: true, environmentVariable }, () => renderWorkspaceTemplateEnvironmentStreams(workspaceTemplateId));
  }

  async function renderWorkspaceTemplateSecretStreams(workspaceTemplateId: string): Promise<string> {
    const workspaceTemplate = await workspaceTemplateById(workspaceTemplateId);
    const secrets = await listWorkspaceTemplateSecrets(workspaceTemplateId);
    return `${replace(domId("workspace_template_secret_fields", workspaceTemplateId), workspaceTemplateSecretFields(workspaceTemplate, secrets))}${replace(domId("workspace_template_secret_warning", workspaceTemplateId), collapsedSecretWarning(workspaceTemplate, secrets))}`;
  }

  async function workspaceTemplateSecretValues(request: Request): Promise<WorkspaceTemplateSecretInput> {
    if (!requestAcceptsJson(request)) {
      const formData = await request.formData();
      const pathPermission = formData.get("allowInPath") ?? undefined;
      if (pathPermission !== undefined && !["true", "false"].includes(String(pathPermission))) throw invalidArguments("Invalid URL path permission");
      return {
        allowInPath: pathPermission === undefined ? undefined : pathPermission === "true",
        envName: String(formData.get("envName") ?? ""),
        hostPattern: String(formData.get("hostPattern") ?? ""),
        placeholder: String(formData.get("placeholder") ?? ""),
        secretValue: String(formData.get("secretValue") ?? "") || undefined,
        annotation: String(formData.get("annotation") ?? ""),
        optional: formData.get("optional") === "true",
      };
    }
    const body = await readJsonObject(request);
    const allowInPath = body.allowInPath;
    if (allowInPath !== undefined && !Value.Check(workspaceTemplateSecretPathPermissionSchema, allowInPath)) throw invalidArguments("allowInPath must be a boolean");
    const optional = body.optional;
    if (optional !== undefined && !Value.Check(jsonBooleanSchema, optional)) throw invalidArguments("optional must be a boolean");
    return {
      envName: requiredJsonString(body, "envName"),
      hostPattern: requiredJsonString(body, "hostPattern"),
      placeholder: optionalJsonString(body, "placeholder"),
      secretValue: optionalJsonString(body, "secretValue"),
      annotation: optionalJsonString(body, "annotation"),
      optional,
      allowInPath,
    };
  }

  async function createWorkspaceTemplateSecretEndpoint(workspaceTemplateId: string, request: Request): Promise<Response> {
    const secret = await createWorkspaceTemplateSecret(workspaceTemplateId, await workspaceTemplateSecretValues(request));
    return workspaceTemplateSettingsResponse(request, { secret }, () => renderWorkspaceTemplateSecretStreams(workspaceTemplateId));
  }

  async function updateWorkspaceTemplateSecretEndpoint(workspaceTemplateId: string, secretId: string, request: Request): Promise<Response> {
    const secret = await updateWorkspaceTemplateSecret(workspaceTemplateId, secretId, await workspaceTemplateSecretValues(request));
    return workspaceTemplateSettingsResponse(request, { secret }, () => renderWorkspaceTemplateSecretStreams(workspaceTemplateId));
  }

  async function deleteWorkspaceTemplateSecretEndpoint(workspaceTemplateId: string, secretId: string, request: Request): Promise<Response> {
    if (requestAcceptsJson(request)) await readJsonObject(request);
    const secret = await deleteWorkspaceTemplateSecret(workspaceTemplateId, secretId);
    return workspaceTemplateSettingsResponse(request, { deleted: true, secret }, () => renderWorkspaceTemplateSecretStreams(workspaceTemplateId));
  }

  async function renderWorkspaceTemplateSshKeyStreams(workspaceTemplateId: string): Promise<string> {
    const workspaceTemplate = await workspaceTemplateById(workspaceTemplateId);
    deps.invalidatePresentation();
    return `${replace(domId("workspace_template_ssh_key_fields", workspaceTemplateId), workspaceTemplateSshKeyFields(workspaceTemplate, await listWorkspaceTemplateSshKeys(workspaceTemplateId)))}`;
  }

  async function updateWorkspaceTemplateSshKnownHostsEndpoint(workspaceTemplateId: string, request: Request): Promise<Response> {
    const input = requestAcceptsJson(request) ? jsonString(await readJsonObject(request), "knownHosts") : String((await request.formData()).get("knownHosts") ?? "");
    const knownHosts = await setWorkspaceTemplateSshKnownHosts(workspaceTemplateId, input);
    return workspaceTemplateSettingsResponse(request, { knownHosts }, async () => replace(domId("workspace_template_ssh_host_trust", workspaceTemplateId), workspaceTemplateSshHostTrustFields(workspaceTemplateId, knownHosts)));
  }

  async function createWorkspaceTemplateSshKeyFromForm(workspaceTemplateId: string, request: Request): Promise<Response> {
    const formData = await request.formData();
    await createWorkspaceTemplateSshKey(workspaceTemplateId, String(formData.get("privateKey") ?? ""), undefined, undefined, String(formData.get("name") ?? ""));
    return turboStreamResponse(await renderWorkspaceTemplateSshKeyStreams(workspaceTemplateId));
  }

  async function renameWorkspaceTemplateSshKeyEndpoint(workspaceTemplateId: string, keyId: string, request: Request): Promise<Response> {
    const name = requestAcceptsJson(request) ? jsonString(await readJsonObject(request), "name") : String((await request.formData()).get("name") ?? "");
    const key = await renameWorkspaceTemplateSshKey(workspaceTemplateId, keyId, name);
    return workspaceTemplateSettingsResponse(request, { key }, () => renderWorkspaceTemplateSshKeyStreams(workspaceTemplateId));
  }

  async function deleteWorkspaceTemplateSshKeyFromForm(workspaceTemplateId: string, keyId: string): Promise<Response> {
    await deleteWorkspaceTemplateSshKey(workspaceTemplateId, keyId);
    return turboStreamResponse(await renderWorkspaceTemplateSshKeyStreams(workspaceTemplateId));
  }

  async function deleteWorkspaceTemplateEndpoint(workspaceTemplateId: string, request: Request): Promise<Response> {
    const json = requestAcceptsJson(request);
    const workspaceTemplate = await workspaceTemplateById(workspaceTemplateId);
    if (json) await readJsonObject(request);
    const references = deps.referencingWorkspaces(workspaceTemplateId);
    if (references.length > 0) {
      if (json) return jsonResponse({
        deleted: false,
        blocked: true,
        references,
      });
      return turboStreamResponse(replace(domId("workspace_template_delete_control", workspaceTemplate.id), workspaceTemplateDeleteControl(workspaceTemplate.id, references)), { status: 422 });
    }
    await deleteWorkspaceTemplate(workspaceTemplateId);
    deps.invalidatePresentation();
    if (json) return jsonResponse({ deleted: true, blocked: false, workspaceTemplate });
    return turboStreamResponse(`${update("workspace_template_editor_body", "")}`);
  }

  async function githubRepositorySearchEndpoint(url: URL): Promise<Response> {
    const query = url.searchParams.get("q") ?? "";
    try {
      const repositories = shouldSearchGitHubRepositories(query) ? await searchGitHubRepositories(query) : [];
      return response(renderGitHubRepositorySearchMenu(repositories, query));
    } catch (error) {
      if (error instanceof GitHubRepositorySearchRateLimitError) return response(renderGitHubRepositorySearchRateLimitMenu(error), { status: 429 });
      throw error;
    }
  }

  async function byReference(reference: string): Promise<WorkspaceTemplateSummary> {
    const { workspaceTemplates } = await listWorkspaceTemplates();
    const byId = workspaceTemplates.find((workspaceTemplate) => workspaceTemplate.id === reference);
    if (byId) return byId;
    const byName = workspaceTemplates.filter((workspaceTemplate) => workspaceTemplate.name === reference);
    if (byName.length === 1) return byName[0]!;
    if (byName.length > 1) throw invalidArguments(`template name is ambiguous: ${reference}`);
    throw new AgentsInTheCloudCoreError("workspace_template_not_found", `template not found: ${reference}`);
  }

  async function handle(request: Request, url: URL): Promise<Response | undefined> {
    if (url.pathname === "/workspace-templates" && request.method === "GET" && requestAcceptsJson(request)) return jsonResponse(await listWorkspaceTemplates());
    if (url.pathname === "/workspace-templates" && request.method === "POST") return await createWorkspaceTemplateEndpoint(request, url);
    if (url.pathname === "/workspace-templates/github-search" && request.method === "GET") return await githubRepositorySearchEndpoint(url);

    let params: string[] | undefined;
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/privileged$/)) && request.method === "POST") return await updateWorkspaceTemplatePrivilegeEndpoint(params[0]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/dockerfile$/)) && request.method === "POST") return await updateWorkspaceTemplateDockerfileEndpoint(params[0]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/preload-images$/)) && request.method === "POST") return await updateWorkspaceTemplatePreloadImagesEndpoint(params[0]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)$/)) && request.method === "GET" && requestAcceptsJson(request)) return await workspaceTemplateDetailEndpoint(params[0]!);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)$/)) && request.method === "POST") return await updateWorkspaceTemplateEndpoint(params[0]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/environment$/)) && request.method === "POST") return await createWorkspaceTemplateEnvironmentVariableEndpoint(params[0]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/environment\/([^/]+)$/)) && request.method === "POST") return await updateWorkspaceTemplateEnvironmentVariableEndpoint(params[0]!, params[1]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/environment\/([^/]+)\/delete$/)) && request.method === "POST") return await deleteWorkspaceTemplateEnvironmentVariableEndpoint(params[0]!, params[1]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/secrets$/)) && request.method === "POST") return await createWorkspaceTemplateSecretEndpoint(params[0]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/secrets\/([^/]+)$/)) && request.method === "POST") return await updateWorkspaceTemplateSecretEndpoint(params[0]!, params[1]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/secrets\/([^/]+)\/delete$/)) && request.method === "POST") return await deleteWorkspaceTemplateSecretEndpoint(params[0]!, params[1]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/ssh-known-hosts$/))) {
      const workspaceTemplateId = params[0]!;
      if (request.method === "GET" && requestAcceptsJson(request)) return jsonResponse({ knownHosts: await getWorkspaceTemplateSshKnownHosts(workspaceTemplateId) });
      if (request.method === "POST") return updateWorkspaceTemplateSshKnownHostsEndpoint(workspaceTemplateId, request);
    }
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/ssh-keys$/)) && request.method === "POST") return await createWorkspaceTemplateSshKeyFromForm(params[0]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/ssh-keys\/([^/]+)\/public-key$/)) && request.method === "GET") return textResponse(await deriveWorkspaceTemplateSshPublicKey(params[0]!, params[1]!));
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/ssh-keys\/([^/]+)$/)) && request.method === "POST") return await renameWorkspaceTemplateSshKeyEndpoint(params[0]!, params[1]!, request);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/ssh-keys\/([^/]+)\/delete$/)) && request.method === "POST") return await deleteWorkspaceTemplateSshKeyFromForm(params[0]!, params[1]!);
    if ((params = matchRoute(url, /^\/workspace-templates\/([^/]+)\/delete$/)) && request.method === "POST") return await deleteWorkspaceTemplateEndpoint(params[0]!, request);
    if ((params = matchRoute(url, /^\/workspace-template-agent-workspaces\/([^/]+)$/)) && request.method === "POST") return await deps.createAgentWorkspace(await workspaceTemplateById(params[0]!), request);
    return undefined;
  }

  return { handle, byReference, editorModal: workspaceTemplateEditorModal };
}
