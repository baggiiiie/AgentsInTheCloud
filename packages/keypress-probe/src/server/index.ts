import { buttonHtml } from "@atelier/design-system/button";
import { atelierDataPath, getAtelierRuntimeContext } from "@atelier/core";
import { readJsonSettings, updateJsonSettings } from "@atelier/core/json-settings";
import { toggleHtml } from "@atelier/design-system/toggle";
import { turboStream, turboStreamResponse, type SettingsContribution, type WorkspaceModule } from "@atelier/shared";

const settingsPath = "/settings/keypress-probe";
const settingsSectionId = "settings-sec-keypress-probe";

function keypressProbeSettingsFile(): string {
  return atelierDataPath(getAtelierRuntimeContext(), "keypress-probe-settings.json");
}

async function isKeypressProbeEnabled(): Promise<boolean> {
  const file = keypressProbeSettingsFile();
  const { enabled = false } = await readJsonSettings(file);
  if (enabled !== true && enabled !== false) throw new Error(`Invalid keypress probe settings in ${file}`);
  return enabled;
}

async function setKeypressProbeEnabled(enabled: boolean): Promise<void> {
  await updateJsonSettings(keypressProbeSettingsFile(), (settings) => { settings.enabled = enabled; });
}

function renderKeypressProbe(): string {
  return `<aside class="keypress-probe" data-controller="keypress-probe" aria-live="polite" title="Shows keyboard events Atelier can capture in this browser context; browser/OS/iframe-reserved shortcuts will not appear.">
    <div class="keypress-probe-head"><strong>Keys</strong><span data-keypress-probe-target="count">0</span>${buttonHtml({ type: "button", variant: "secondary", content: { kind: "caption", caption: "Clear keys" }, attributesHtml: 'data-action="keypress-probe#clear"' })}</div>
    <ol data-keypress-probe-target="list"><li class="empty">Press keys… browser/iframe-reserved combos will not appear.</li></ol>
  </aside>`;
}

async function renderKeypressProbeSettings(): Promise<string> {
  const enabled = await isKeypressProbeEnabled();
  const toggle = toggleHtml({
    variant: "text",
    label: "Keylogging probe",
    name: "enabled",
    value: String(enabled),
    form: {
      id: "settings_keypress_probe",
      action: settingsPath,
    },
    options: [
      { label: "Off", value: "false" },
      { label: "On", value: "true" },
    ],
  });
  return `<section class="settings-sec settings-sec-keypress-probe settings-sec-development" id="${settingsSectionId}">
    <div class="settings-development-action">
      <div class="settings-development-copy">
        <div>Shortcut probe</div>
        <p>Show a local keyboard-event overlay in workspaces. Events are not stored; browser, OS, and iframe-reserved shortcuts may not reach Atelier.</p>
      </div>
      <div class="settings-development-control">${toggle}</div>
    </div>
  </section>`;
}

const keypressProbeSettingsContribution: SettingsContribution = {
  id: "keypress-probe",
  label: "Shortcut probe",
  order: 90,
  render: renderKeypressProbeSettings,
  async handleAction({ request, url }) {
    if (url.pathname !== settingsPath || request.method !== "POST") return undefined;
    const form = await request.formData();
    const enabled = form.get("enabled") === "true";
    await setKeypressProbeEnabled(enabled);
    return turboStreamResponse(`${turboStream("replace", settingsSectionId, await renderKeypressProbeSettings())}${turboStream("remove", ".keypress-probe", "", { targets: true })}${enabled ? turboStream("append", ".fixed-workspace-presentation", renderKeypressProbe(), { targets: true }) : ""}`);
  },
};

const keypressProbeStaticFiles = {
  "/keypress-probe.css": { url: new URL("../client/style.css", import.meta.url), contentType: "text/css; charset=utf-8" },
} as const;

const keypressProbeWorkspaceModule: WorkspaceModule = {
  id: "keypress-probe",
  staticFiles: keypressProbeStaticFiles,
  settingsContributions: [keypressProbeSettingsContribution],
  async attachToWorkspace() {
    return await isKeypressProbeEnabled() ? { overlayHtml: [renderKeypressProbe()] } : {};
  },
};

export { keypressProbeWorkspaceModule as atelierServerModule };
