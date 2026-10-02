import { handleAccessSettings } from "./access.ts";
import { handleGitHubSettingsRequest } from "./github.ts";
import { handleModelSettingsRequest } from "@agents-in-the-cloud/llm/server";
import { finishOnboarding } from "../onboarding/state.ts";
import { handleSettingsPageRequest, type WorkspaceCleanupResult } from "./page.ts";
import { listSettingsContributions } from "./registry.ts";
import { handleThemeSettingsRequest } from "./theme.ts";

export async function handleSettingsRequest(
  request: Request,
  url: URL,
  options: { forceDeleteAllWorkspaces?: () => Promise<WorkspaceCleanupResult>; renderModelPickerUpdates: () => Promise<string>; themeChanged: () => void },
): Promise<Response | undefined> {
  const response = await handleAccessSettings(request, url)
    ?? await handleThemeSettingsRequest(request, url, options.themeChanged)
    ?? await handleSettingsPageRequest(request, url, options)
    ?? await handleGitHubSettingsRequest(request, url)
    ?? await handleModelSettingsRequest(request, url, options.renderModelPickerUpdates, finishOnboarding);
  if (response) return response;

  for (const contribution of listSettingsContributions()) {
    const handled = await contribution.handleAction?.({ request, url });
    if (handled) return handled;
  }
  return undefined;
}
