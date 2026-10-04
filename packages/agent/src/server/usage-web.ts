import { response } from "@agents-in-the-cloud/shared/http";
import { requestAcceptsJson } from "@agents-in-the-cloud/core";
import { providerUsageFrameId, providersInLastInferenceWindow, selectSubscriptionLimit, secondsUntilUsageLimit, type PacedUsageWindow, connectedUsageProviders, getProviderUsageOverview, supportedUsageProviders, type ProviderUsageOverview, type UsageProvider } from "@agents-in-the-cloud/llm/server";
import { actionLinkHtml } from "@agents-in-the-cloud/design-system/action-link";
import { comparisonRingHtml } from "@agents-in-the-cloud/design-system/comparison-ring";
import { dialogHtml } from "@agents-in-the-cloud/design-system/dialog";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { escapeHtml, providerBadgeHtml, turboStream, turboStreamResponse, workspaceModuleModalFrameId, type WorkspaceModuleRouteContext } from "@agents-in-the-cloud/shared";

function jsonResponse<Body extends object>(body: Body, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function renderUsagePaneAction(): string {
  const button = usageButtonHtml();
  const actions = [
    "agents-in-the-cloud:usage:refreshed@document->usage-button#refresh",
    "visibilitychange@document->usage-button#refresh",
    "focus@window->usage-button#refresh",
  ].join(" ");
  return `<span data-controller="usage-button" data-action="${actions}"><template data-usage-button-target="empty">${button}</template><turbo-frame id="usage_button_content">${button}</turbo-frame></span>`;
}
const overviewFrameId = "usage_overview";
const providerPath = (id: string, refresh: boolean) => `/usage/providers/${encodeURIComponent(id)}${refresh ? "?refresh=1" : ""}`;
const providerFrameId = (id: string) => `usage_provider_${id}`;
const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** Two compact units for allowance windows, reset countdowns, and pacing gaps. */
function usageDuration(seconds: number): string {
  let remaining = Math.max(0, Math.floor(seconds));
  const parts: string[] = [];
  for (const [size, suffix] of [[86400, "d"], [3600, "h"], [60, "m"], [1, "s"]] as const) {
    const count = Math.floor(remaining / size);
    remaining %= size;
    if (count) parts.push(`${count}${suffix}`);
    if (parts.length === 2) break;
  }
  return parts.join(" ") || "0s";
}

/** Display the schedule distance, not a prediction of allowance exhaustion. */
function usagePace(seconds: number | null): string {
  if (seconds === null) return "";
  if (Math.abs(seconds) < 1) return "On pace";
  return `${usageDuration(Math.abs(seconds))} ${seconds > 0 ? "ahead of" : "behind"} pace`;
}

function renderUsageWindow(paced: PacedUsageWindow): string {
  const { reported: window, timing } = paced;
  const label = `${window.limitName} · ${usageDuration(window.durationSeconds)}`;
  const remaining = window.resetsAt === null ? null : (new Date(window.resetsAt).getTime() - Date.now()) / 1000;
  const reset = remaining === null ? "Reset time unavailable" : remaining > 0 ? `Resets in ${usageDuration(remaining)}` : "Reset due";
  const difference = timing.paceDifferenceSeconds;
  const pace = difference === null ? "—" : Math.abs(difference) < 1 ? "on pace" : `${usageDuration(Math.abs(difference))} ${difference > 0 ? "ahead" : "behind"}`;
  const runwaySeconds = secondsUntilUsageLimit(paced);
  const runway = timing.state !== "active" || (timing.elapsedPercent === 0 && window.usedPercent > 0 && window.usedPercent < 100)
    ? "—" : runwaySeconds === Infinity ? "to reset" : usageDuration(runwaySeconds);
  const elapsed = timing.elapsedPercent;
  return `<article class="usage-limit">
    <div class="usage-limit-title"><h3>${escapeHtml(label)}</h3>
      ${elapsed === null ? "" : `<div class="usage-comparison${difference === null ? " usage-comparison--inactive" : ""}" aria-hidden="true">
        <span class="usage-comparison__time" style="width:${elapsed}%"></span>
        <span class="usage-comparison__usage" style="width:${window.usedPercent}%"></span>
        <span class="usage-comparison__shared" style="width:${Math.min(elapsed, window.usedPercent)}%"></span>
      </div>`}
    </div>
    <div class="usage-metrics usage-caption" tabindex="0" role="group" aria-label="Limit metrics">
      <span title="Window start inferred from reset time minus duration">Time ${elapsed === null ? "—" : `${number(elapsed)}%`}</span>
      <span>Used ${number(window.usedPercent)}%</span>
      <span title="Time until this limit fills at the average consumption rate since the window began. Forecast stops at the next reset.">Runway ${runway}</span>
      <span title="Distance along the linear allowance schedule, not a forecast">Pace ${pace}</span>
      <span>${reset}</span>
    </div>
  </article>`;
}

function shownUsageWindows(windows: PacedUsageWindow[]) {
  return {
    used: windows.filter(({ reported }) => reported.usedPercent > 0),
    unused: windows.filter(({ reported }) => reported.usedPercent === 0 && reported.meteredFeature !== "chatpass"),
  };
}

function renderUsageLimits({ reported, error, windows }: ProviderUsageOverview): string {
  if (error) return `<p class="usage-error" role="alert">${escapeHtml(error)}</p>`;
  if (!reported) return "<p>Disconnected.</p>";
  const { used, unused } = shownUsageWindows(windows);
  return `${reported.limitReached || reported.allowed === false ? '<p class="usage-error" role="status">Subscription limit reached.</p>' : ""}${used.map(renderUsageWindow).join("")}${unused.length ? `<details class="usage-unused"${used.length ? "" : " open"}><summary>Unused limits (${unused.length})</summary><div class="usage-section">${unused.map(renderUsageWindow).join("")}</div></details>` : ""}${used.length || unused.length || reported.balance ? "" : '<p>No limits reported.</p>'}`;
}

function money(amount: number, currency: string): string {
  return amount.toLocaleString("en-US", { style: "currency", currency });
}

function renderUsageAccount({ reported, error }: ProviderUsageOverview): string {
  if (!reported || error) return "";
  const { credits, resets, balance } = reported;
  const rows: string[] = [];
  if (balance) rows.push(`<div class="usage-limit-heading"><dt>Available credit</dt><dd><strong>${money(balance.available, balance.currency)}</strong></dd></div>`, `<div class="usage-limit-heading"><dt>Spent this month</dt><dd><strong>${money(balance.monthSpend, balance.currency)}</strong></dd></div>`);
  if (resets) rows.push(`<div class="usage-limit-heading"><dt>Available resets</dt><dd><strong>${number(resets.available)}</strong></dd></div>`);
  if (credits) rows.push(`<div class="usage-limit-heading"><dt>Credit balance</dt><dd><strong>${credits.unlimited ? "Unlimited" : credits.balance !== null ? Number(credits.balance).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "Not reported"}</strong></dd></div>`);
  if (!rows.length) return "";
  return `<article class="usage-limit"><h3>${balance ? "Credits" : "Account allowance"}</h3><dl class="usage-account">${rows.join("")}</dl></article>`;
}

function renderUsageProvider(overview: ProviderUsageOverview): string {
  const { reported } = overview;
  return `<section class="usage-provider" data-controller="usage-snapshot"><header class="usage-provider-heading"><h2>${providerBadgeHtml(overview.provider.id, overview.provider.label, "usage-provider-icon")}${escapeHtml(overview.provider.label)}</h2>${reported?.plan ? `<span class="usage-plan">${escapeHtml(reported.plan)}</span>` : ""}</header>
    <section class="usage-section">
      ${renderUsageLimits(overview)}
      ${renderUsageAccount(overview)}
    </section>
  </section>`;
}

function usageWindowCaption(window: PacedUsageWindow["reported"]): string {
  return window.meteredFeature === null ? usageDuration(window.durationSeconds).split(" ")[0]! : window.limitName.slice(0, 2);
}

/** Prepaid providers show their balance instead. One small ring per limit: its length for main allowances ("5h"), the first letters of a feature's name ("Op") otherwise. */
function renderUsageRings({ provider, reported, error, windows }: ProviderUsageOverview, scope: string): string {
  const { used, unused } = shownUsageWindows(windows);
  const rings = reported && !error ? [...used, ...unused].map(({ reported: window, timing }) => comparisonRingHtml({
    caption: usageWindowCaption(window),
    referencePercent: timing.elapsedPercent ?? 0,
    valuePercent: window.usedPercent,
    label: `${window.limitName} · ${usageDuration(window.durationSeconds)}: ${timing.elapsedPercent === null ? "reset time unavailable" : `Time ${number(timing.elapsedPercent)}%`}, Usage ${number(window.usedPercent)}%`,
  })).join("") : "";
  const balance = reported?.balance && !error ? `<span class="usage-caption">${money(reported.balance.available, reported.balance.currency)} left</span>` : "";
  return `<turbo-frame class="usage-rings" id="${providerUsageFrameId("rings", provider.id, scope)}">${rings || balance || `<span class="usage-caption"${error ? ` title="${escapeHtml(error)}"` : ""}>Usage unavailable</span>`}</turbo-frame>`;
}

/** Limits alone, for surfaces that already name the provider. */
function renderUsageProviderLimits(overview: ProviderUsageOverview, scope: string): string {
  return `<turbo-frame id="${providerUsageFrameId("limits", overview.provider.id, scope)}"><section class="usage-section">${renderUsageLimits(overview)}${renderUsageAccount(overview)}</section></turbo-frame>`;
}

function usageButtonHtml(comparison?: { referencePercent: number; valuePercent: number }, label = "Usage", caption?: string): string {
  const iconHtml = caption === undefined ? Icons.Usage : `<span class="comparison-ring__caption">${escapeHtml(caption)}</span>`;
  return actionLinkHtml({ href: "/usage", variant: "secondary", content: { kind: "icon-only", iconHtml, label }, perimeterComparison: comparison, attributesHtml: `data-turbo-frame="${workspaceModuleModalFrameId}"` });
}

async function renderUsageButton(): Promise<string> {
  const activity = providersInLastInferenceWindow();
  if (!activity.length) return usageButtonHtml(undefined, "Usage — no subscription inference recorded");
  const overviews = await Promise.all(supportedUsageProviders.filter((provider) => activity.includes(provider.id)).map((provider) => getProviderUsageOverview(provider)));
  const selected = selectSubscriptionLimit(overviews);
  if (!selected) return usageButtonHtml(undefined, "Usage — selected subscription limits unavailable");
  const { provider, window: { reported, timing } } = selected;
  if (timing.state !== "active") throw new Error("Selected subscription limit must be active");
  const pace = usagePace(timing.paceDifferenceSeconds);
  return usageButtonHtml({ referencePercent: timing.elapsedPercent, valuePercent: reported.usedPercent }, `Usage — ${provider.label} · ${reported.limitName} ${usageDuration(reported.durationSeconds)}: Time ${number(timing.elapsedPercent)}%, Usage ${number(reported.usedPercent)}% · ${pace} · Providers from 30 minutes before last inference`, usageWindowCaption(reported));
}

function providerPlaceholder(provider: UsageProvider, refresh: boolean): string {
  return `<turbo-frame id="${providerFrameId(provider.id)}" src="${escapeHtml(providerPath(provider.id, refresh))}"><section class="usage-provider"><h2>${escapeHtml(provider.label)}</h2><p role="status"><span class="status-spinner" aria-hidden="true"></span> Loading…</p></section></turbo-frame>`;
}

async function renderUsageOverview(refresh = false): Promise<string> {
  const providers = await connectedUsageProviders();
  return `<turbo-frame id="${overviewFrameId}" class="usage-overview">${providers.map((provider) => providerPlaceholder(provider, refresh)).join("") || '<p class="usage-caption">Connect OpenAI Codex or an Anthropic subscription in Settings to see usage.</p>'}</turbo-frame>`;
}

async function renderUsageDialog(): Promise<string> {
  return dialogHtml({
    element: { id: "usage_dialog", attributesHtml: "data-dialog-auto-show" },
    iconHtml: Icons.Usage,
    titleCaption: "Usage",
    bodyHtml: await renderUsageOverview(),
    footerHtml: actionLinkHtml({ href: "/usage/overview?refresh=1", variant: "secondary", content: { kind: "caption", caption: "Refresh" }, attributesHtml: `data-turbo-frame="${overviewFrameId}"` }),
  });
}

export async function handleUsageRequest(request: Request, url: URL, context: WorkspaceModuleRouteContext): Promise<Response | undefined> {
  if (request.method !== "GET") return undefined;
  const json = requestAcceptsJson(request);
  const refresh = url.searchParams.has("refresh");
  if (url.pathname === "/usage/button") {
    const button = await renderUsageButton();
    return request.headers.get("accept")?.includes("text/vnd.turbo-stream.html")
      ? turboStreamResponse(turboStream("update", "usage_button_content", button))
      : response(`<turbo-frame id="usage_button_content">${button}</turbo-frame>`);
  }
  if (url.pathname === "/usage") {
    if (json) return jsonResponse({ providers: await Promise.all((await connectedUsageProviders()).map((provider) => getProviderUsageOverview(provider, { refresh }))) });
    const dialog = await renderUsageDialog();
    return request.headers.has("turbo-frame")
      ? response(`<turbo-frame id="${workspaceModuleModalFrameId}">${dialog}</turbo-frame>`)
      : context.renderModalPage(dialog);
  }
  if (url.pathname === "/usage/overview") return response(await renderUsageOverview(refresh));
  const match = url.pathname.match(/^\/usage\/providers\/([^/]+)(?:\/(limits|rings))?$/);
  if (!match) return undefined;
  const provider = supportedUsageProviders.find((provider) => provider.id === match[1]);
  if (!provider) return jsonResponse({ error: { code: "unsupported_usage_provider", message: "Subscription usage is not supported for this provider." } }, 404);
  const overview = await getProviderUsageOverview(provider, { refresh });
  if (json) return jsonResponse(overview);
  // Surfaces that embed these frames name their scope so their frame ids match.
  const scope = url.searchParams.get("scope") ?? "";
  if (match[2] === "limits") return response(renderUsageProviderLimits(overview, scope));
  if (match[2] === "rings") return response(renderUsageRings(overview, scope));
  return response(`<turbo-frame id="${providerFrameId(provider.id)}">${renderUsageProvider(overview)}</turbo-frame>`);
}
