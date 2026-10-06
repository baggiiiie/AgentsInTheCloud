import { renderConnectionModeSettings } from "./connection-mode.ts";
import { actionLinkHtml } from "@agents-in-the-cloud/design-system/action-link";
import { dialogHtml } from "@agents-in-the-cloud/design-system/dialog";
import { destructiveConfirmationHtml } from "@agents-in-the-cloud/design-system/destructive-confirmation";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { createPiModelRuntime, modelsDialogId, setEnabledModels } from "@agents-in-the-cloud/llm/server";
import { invalidArguments } from "@agents-in-the-cloud/core";
import { errorMessage, escapeHtml } from "@agents-in-the-cloud/shared";
import { clearGitHubToken } from "@agents-in-the-cloud/proxy-egress";
import { publicInstanceUrl } from "@agents-in-the-cloud/proxy-ingress";
import { clearCommitIdentity, getCommitIdentity, setCommitIdentity } from "@agents-in-the-cloud/workspace-templates";
import { instanceUrlHtml } from "../instance-url.ts";
import { resetOnboarding } from "../onboarding/state.ts";
import { renderOnboardingDialog } from "../onboarding/routes.ts";
import { workspaceModules } from "../workspace-modules.generated.ts";
import { remove, replace, response, stream, update, wantsStream } from "@agents-in-the-cloud/shared/http";
import { listSettingsContributions, registerSettingsContribution } from "./registry.ts";
import { renderThemeSettings } from "./theme.ts";

function devSettingsEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

async function renderCommitIdentityForm(error = ""): Promise<string> {
  const identity = await getCommitIdentity();
  return `<form id="settings_commit_identity" class="settings-commit-identity" method="post" action="/settings/commit-identity" autocomplete="off" data-controller="commit-identity" data-action="input->commit-identity#queue change->commit-identity#save submit->commit-identity#submit">
    ${error ? `<p class="settings-error">${escapeHtml(error)}</p>` : ""}
    <label class="settings-field"><span class="settings-field-label">Commit author name</span><input class="settings-input text-field" name="commitAuthorName" value="${escapeHtml(identity?.name ?? "")}" placeholder="Ada Lovelace" autocomplete="off" data-1p-ignore required></label>
    <label class="settings-field"><span class="settings-field-label">Commit author email</span><input class="settings-input text-field" type="email" name="commitAuthorEmail" value="${escapeHtml(identity?.email ?? "")}" placeholder="ada@example.com" autocomplete="off" data-1p-ignore required></label>
  </form>`;
}

async function renderCommitIdentitySettings(): Promise<string> {
  return `<section class="settings-sec" id="settings-sec-commit-identity"><h2>Commit identity</h2>${await renderCommitIdentityForm()}</section>`;
}

function renderBuildIdentity(): string {
  const commit = process.env.ATELIER_COMMIT_ID;
  if (!commit) return `<span class="settings-build-identity">Local development build</span>`;
  const commitUrl = `https://github.com/lucasmeijer/atelier/commit/${encodeURIComponent(commit)}`;
  return `<a class="settings-build-identity" href="${commitUrl}" target="_blank" rel="noreferrer">${escapeHtml(commit.slice(0, 7))}</a>`;
}

export type WorkspaceCleanupResult = { deleted: number; errors: string[] };

function renderForceDeleteWorkspaces(result?: WorkspaceCleanupResult): string {
  const confirmation = destructiveConfirmationHtml({
    id: "delete_all_workspaces",
    trigger: { type: "button", variant: "danger", content: { kind: "caption", caption: "Delete all workspaces" } },
    confirmCaption: "Delete all workspaces",
    cancelCaption: "Cancel",
  });
  const deleted = result === undefined ? "" : `<p class="settings-development-status" role="status">Deleted ${escapeHtml(result.deleted)} workspace${result.deleted === 1 ? "" : "s"}.</p>`;
  const errors = result?.errors.length ? `<p class="settings-error">${escapeHtml(result.errors.join("\n"))}</p>` : "";
  return `<div id="settings_force_delete_workspaces" class="settings-development-action">
    <div class="settings-development-copy">
      <div>Workspaces</div>
      <p>Permanently delete every workspace and its files.</p>
      ${deleted}${errors}
    </div>
    <div class="settings-development-control"><form method="post" action="/settings/workspaces/force-delete" data-turbo="true">${confirmation}</form></div>
  </div>`;
}

function renderResetSettings(): string {
  const confirmation = destructiveConfirmationHtml({
    id: "delete_all_settings",
    trigger: { type: "button", variant: "danger", content: { kind: "caption", caption: "Delete all settings" } },
    confirmCaption: "Delete all settings",
    cancelCaption: "Cancel",
  });
  return `<div class="settings-development-action">
    <div class="settings-development-copy">
      <div>Stored settings</div>
      <p>Delete the Commit identity, GitHub token, and model provider credentials stored by AgentsInTheCloud.</p>
    </div>
    <div class="settings-development-control"><form method="post" action="/settings/reset" data-turbo="true">${confirmation}</form></div>
  </div>`;
}

async function renderDevelopmentSettings(): Promise<string> {
  const keypressProbeSettings = await listSettingsContributions().find((contribution) => contribution.id === "keypress-probe")?.render() ?? "";
  const destructiveActions = `${renderResetSettings()}${devSettingsEnabled() ? renderForceDeleteWorkspaces() : ""}`;
  return `${keypressProbeSettings}<section class="settings-sec settings-sec-development">${destructiveActions}</section>`;
}

registerSettingsContribution({ id: "access", label: "Connection mode", order: 15, render: renderConnectionModeSettings });
registerSettingsContribution({ id: "theme", label: "Theme", order: 10, render: renderThemeSettings });
registerSettingsContribution({ id: "commit-identity", label: "Commit identity", order: 20, render: renderCommitIdentitySettings });
for (const module of workspaceModules) {
  for (const contribution of module.settingsContributions ?? []) registerSettingsContribution(contribution);
}

function settingsDialogHtml(titleCaption: string, bodyHtml: string, sectionId?: string): string {
  const sectionAttributes = sectionId ? ` data-controller="scroll-into-view" data-scroll-into-view-target-id-value="${escapeHtml(`settings-sec-${sectionId}`)}" data-action="turbo:frame-load->scroll-into-view#frameLoaded"` : "";
  return dialogHtml({
    element: {
      id: "settings_dialog",

      attributesHtml: `data-dialog-auto-show${sectionAttributes}`,
    },
    iconHtml: Icons.Settings,
    titleCaption,
    bodyHtml,
    bodyLayout: "full-bleed",
    closeLabel: "Close settings",
  });
}

export async function renderSettingsDialog(request: Request, sectionId?: string): Promise<string> {
  // Keep previously published Settings links working without retaining the old app name.
  if (sectionId === "git-identity") sectionId = "commit-identity";
  const contributions = listSettingsContributions().filter((contribution) => contribution.id !== "keypress-probe");
  if (sectionId && !contributions.some((contribution) => contribution.id === sectionId)) throw invalidArguments(`settings section not found: ${sectionId}`);
  const sections = await Promise.all(contributions.map((contribution) => contribution.render()));
  return settingsDialogHtml("Settings", `<main class="settings-main"><section class="settings-sec" id="settings-sec-instance-url"><h2>External URL</h2>${instanceUrlHtml(publicInstanceUrl(request), "settings_instance_url_qr")}</section>${sections.join("")}<div class="settings-dev-link"><a class="settings-development-link" href="/settings/development" data-turbo-frame="_top" data-turbo-stream="true">Development settings</a>${renderBuildIdentity()}</div></main>`, sectionId);
}

export async function renderDevelopmentSettingsDialog(): Promise<string> {
  const backLink = actionLinkHtml({
    href: "/settings",
    variant: "secondary",
    content: { kind: "caption", caption: "Back to settings" },
    attributesHtml: 'data-turbo-frame="_top" data-turbo-stream="true"',
  });
  const catalogueLink = actionLinkHtml({
    href: "/design-system-catalogue.html",
    variant: "secondary",
    content: { kind: "caption", caption: "Design system catalogue" },
    attributesHtml: 'data-turbo="false"',
  });
  return settingsDialogHtml("Development settings", `<main class="settings-main settings-main-dev">${await renderDevelopmentSettings()}<nav class="settings-development-back" aria-label="Settings navigation">${backLink}${catalogueLink}</nav></main>`);
}

async function deleteAllStoredSettings(): Promise<void> {
  await resetOnboarding();
  clearGitHubToken();
  await clearCommitIdentity();
  await setEnabledModels([]);
  const runtime = await createPiModelRuntime();
  for (const credential of await runtime.listCredentials()) await runtime.logout(credential.providerId);
}

export async function handleSettingsPageRequest(request: Request, url: URL, options: { forceDeleteAllWorkspaces?: () => Promise<WorkspaceCleanupResult>; renderModelPickerUpdates: () => Promise<string> }): Promise<Response | undefined> {
  if (url.pathname === "/settings" && request.method === "GET") {
    const html = await renderSettingsDialog(request);
    return wantsStream(request) ? stream(update("settings_modal_host", html)) : response(html);
  }
  if (url.pathname === "/settings/development" && request.method === "GET") {
    const html = await renderDevelopmentSettingsDialog();
    return wantsStream(request) ? stream(update("settings_modal_host", html)) : response(html);
  }
  if (url.pathname === "/settings/reset" && request.method === "POST") {
    await deleteAllStoredSettings();
    const pickerUpdates = await options.renderModelPickerUpdates();
    return stream(`${pickerUpdates}${replace("settings_dialog", await renderDevelopmentSettingsDialog())}${update("onboarding_modal_host", await renderOnboardingDialog())}${remove(modelsDialogId)}`);
  }
  if (url.pathname === "/settings/workspaces/force-delete" && request.method === "POST" && devSettingsEnabled()) {
    const result = options.forceDeleteAllWorkspaces
      ? await options.forceDeleteAllWorkspaces()
      : { deleted: 0, errors: ["Workspace deletion is not available."] };
    return stream(replace("settings_force_delete_workspaces", renderForceDeleteWorkspaces(result)));
  }
  // Retain the old POST URL as an external boundary for existing clients.
  if ((url.pathname === "/settings/commit-identity" || url.pathname === "/settings/git-identity") && request.method === "POST") {
    const form = await request.formData();
    try {
      await setCommitIdentity({ name: String(form.get("commitAuthorName") ?? ""), email: String(form.get("commitAuthorEmail") ?? "") });
    } catch (error) {
      const message = errorMessage(error);
      return stream(replace("settings_commit_identity", await renderCommitIdentityForm(message)));
    }
    return stream(`${replace("settings_dialog", await renderSettingsDialog(request))}${update("onboarding_modal_host", await renderOnboardingDialog())}`);
  }
  return undefined;
}
