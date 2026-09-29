/** The standalone, server-rendered viewer for this workspace's iOS simulators. */
import type { Sim } from './core';

export type ViewerAction = "home" | "open" | "screenshot" | "type" | "tap" | "swipe" | "model";

export interface ViewerDeps {
  list(): Promise<Sim[]>;
  models(): Promise<string[]>;
  stream(sim: string): Promise<Response> | Response;
  action(sim: string, action: ViewerAction, data: Record<string, string>): Promise<Response | void>;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

const stylesheet = `
:root{color-scheme:dark;font:15px/1.45 system-ui,-apple-system,sans-serif;background:#101319;color:#ebedf3}
*{box-sizing:border-box}body{margin:0}header{padding:25px max(22px,calc((100vw - 1200px)/2));border-bottom:1px solid #303540;background:#171b23}
h1{font-size:22px;letter-spacing:-.03em;margin:0 0 4px}header p{color:#aeb7c8;margin:0}
main{max-width:1200px;margin:auto;padding:26px 22px 65px}.empty{border:1px dashed #454b59;border-radius:14px;padding:35px;color:#b6bdcc}
.empty code{color:#d6c5ff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:22px;align-items:start}
.device{border:1px solid #343a46;border-radius:16px;background:#1b202a;overflow:hidden}.device-head{padding:15px 18px;border-bottom:1px solid #343a46;display:flex;justify-content:space-between;align-items:center;gap:12px}
.device-head strong{font-size:17px}.subtitle{display:block;color:#a5aeba;font-size:12px;margin-top:3px;word-break:break-all}.state{border:1px solid #465160;border-radius:99px;padding:3px 9px;font-size:12px;color:#b9c7dc;white-space:nowrap}
.screen-wrap{background:#0b0d12;display:flex;justify-content:center;padding:18px;min-height:160px}.screen{display:block;max-width:100%;width:auto;height:auto;max-height:68vh;object-fit:contain;border-radius:20px;touch-action:none;user-select:none;-webkit-user-drag:none;cursor:crosshair;background:#08090c}
.controls{padding:16px 18px 19px;display:grid;gap:13px}.row{display:flex;gap:8px;align-items:end;flex-wrap:wrap}form{margin:0}label{display:block;font-size:12px;color:#b8c2d0;margin-bottom:5px}
input,select,button,.button{font:inherit;border-radius:8px;min-height:37px}input,select{background:#10151d;color:#f1f3f6;border:1px solid #4a5260;padding:7px 10px;min-width:0}input:focus-visible,select:focus-visible,button:focus-visible,.button:focus-visible{outline:2px solid #a6afff;outline-offset:2px}
button,.button{border:1px solid #5b6475;background:#303948;color:#f4f5f8;padding:7px 12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}button:hover,.button:hover{background:#425066}.primary{background:#6963d7;border-color:#8380e9}.primary:hover{background:#7b76e9}.field{flex:1;min-width:170px}.field input,.field select{width:100%}.hint{color:#939dad;font-size:12px;margin:0}.error{border:1px solid #ad6060;color:#ffd1cf;background:#3a2428;padding:10px;border-radius:8px;margin-bottom:20px}
@media(max-width:600px){header{padding:18px 16px}main{padding:16px}.screen-wrap{padding:10px}.screen{max-height:64vh}}
`;

function deviceHtml(device: Sim, models: string[]): string {
  const handle = encodeURIComponent(device.handle);
  const action = `/viewer/action/${handle}`;
  const options = models.map((model) => `<option value="${escapeHtml(model)}"${model === device.model ? " selected" : ""}>${escapeHtml(model)}</option>`).join("");
  const stream = device.state.toLowerCase() === "booted"
    ? `<img class="screen" src="/viewer/stream/${handle}" alt="Live screen of ${escapeHtml(device.handle)}" draggable="false" data-gesture-sim="${escapeHtml(device.handle)}">`
    : `<p class="hint">Simulator is ${escapeHtml(device.state)}. Start it to view its screen.</p>`;
  return `<article class="device">
    <div class="device-head"><div><strong>${escapeHtml(device.handle)} · ${escapeHtml(device.model)}</strong><span class="subtitle" title="${escapeHtml(device.udid)}">${escapeHtml(device.name)} · ${escapeHtml(device.udid)}</span></div><span class="state">${escapeHtml(device.state)}</span></div>
    <div class="screen-wrap">${stream}</div>
    <div class="controls">
      <div class="row"><form method="post" action="${action}/home"><button type="submit">Home</button></form><a class="button" href="/viewer/screenshot/${handle}" target="_blank" rel="noopener">Screenshot</a></div>
      <form method="post" action="${action}/open" class="row"><div class="field"><label for="url-${handle}">Open URL</label><input id="url-${handle}" type="url" name="url" value="${escapeHtml(device.lastUrl ?? "")}" placeholder="http://localhost:3000" required></div><button class="primary" type="submit">Open</button></form>
      <form method="post" action="${action}/type" class="row"><div class="field"><label for="text-${handle}">Type text</label><input id="text-${handle}" type="text" name="text" autocomplete="off" required></div><button type="submit">Type</button></form>
      <form method="post" action="${action}/model" class="row" data-confirm-model><div class="field"><label for="model-${handle}">iPhone model</label><select id="model-${handle}" name="model">${options}</select></div><button type="submit">Switch model</button></form>
      <p class="hint">Switching models recreates this simulator. Its site data and installed PWAs will be lost. Drag on the screen to swipe; click or tap to touch.</p>
    </div>
  </article>`;
}

function page(devices: Sim[], models: string[], error?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iOS Simulators</title><style>${stylesheet}</style><script src="/viewer/gestures.js" defer></script></head><body>
<header><h1>iOS Simulators</h1><p>Live screens from this workspace's simulators</p></header><main>
${error ? `<div role="alert" class="error">${escapeHtml(error)}</div>` : ""}
${devices.length ? `<div class="grid">${devices.map((device) => deviceHtml(device, models)).join("")}</div>` : `<div class="empty">No simulators yet. Run <code>bun tools/ios-sim/cli.ts start</code> in the terminal, then refresh this page.</div>`}
</main></body></html>`;
}

// Browsers receive actual markup from the server; this script only handles gestures and confirmation.
const gestures = `
for (const form of document.querySelectorAll('[data-confirm-model]')) {
  form.addEventListener('submit', event => {
    if (!confirm('Recreate this simulator with the selected model? Site data and installed PWAs will be lost.')) event.preventDefault();
  });
}
for (const img of document.querySelectorAll('[data-gesture-sim]')) {
  let start;
  const point = event => {
    // Send screen fractions; the server resolves current native point dimensions.
    const rect = img.getBoundingClientRect();
    return {x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))};
  };
  img.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !img.naturalWidth) return;
    start = {id: event.pointerId, clientX: event.clientX, clientY: event.clientY, ...point(event)};
    img.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  img.addEventListener('pointercancel', () => { start = undefined; });
  img.addEventListener('pointerup', async event => {
    if (!start || start.id !== event.pointerId) return;
    const from = start;
    start = undefined;
    const to = point(event);
    const swipe = Math.hypot(event.clientX - from.clientX, event.clientY - from.clientY) >= 15;
    const body = new URLSearchParams(swipe ? {x1: String(from.x), y1: String(from.y), x2: String(to.x), y2: String(to.y)} : {x: String(to.x), y: String(to.y)});
    try {
      const response = await fetch('/viewer/action/' + encodeURIComponent(img.dataset.gestureSim) + '/' + (swipe ? 'swipe' : 'tap'), {method: 'POST', body});
      if (!response.ok) alert(await response.text());
    } catch (error) { alert(String(error)); }
  });
}
`;

export async function handleViewerRequest(request: Request, deps: ViewerDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/") {
    return new Response(page(await deps.list(), await deps.models()), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (request.method === "GET" && path === "/viewer/gestures.js") {
    return new Response(gestures, { headers: { "content-type": "text/javascript; charset=utf-8" } });
  }
  const stream = /^\/viewer\/stream\/([^/]+)$/.exec(path);
  if (request.method === "GET" && stream) return deps.stream(decodeURIComponent(stream[1]!));
  const screenshot = /^\/viewer\/screenshot\/([^/]+)$/.exec(path);
  if (request.method === "GET" && screenshot) {
    return (await deps.action(decodeURIComponent(screenshot[1]!), "screenshot", {})) ?? new Response("Screenshot unavailable", { status: 500 });
  }
  const match = /^\/viewer\/action\/([^/]+)\/(home|open|type|tap|swipe|model)$/.exec(path);
  if (request.method === "POST" && match) {
    // SAFETY: The route regex matches only the ViewerAction literals listed above.
    const action = match[2] as ViewerAction;
    const sim = decodeURIComponent(match[1]!);
    const form = await request.formData();
    const data = Object.fromEntries([...form].map(([key, value]) => [key, String(value)]));
    try {
      const result = await deps.action(sim, action, data);
      if (result) return result;
      return Response.redirect(new URL("/", request.url), 303);
    } catch (error) {
      if (action === "tap" || action === "swipe") return new Response(String(error), { status: 500 });
      return new Response(page(await deps.list(), await deps.models(), String(error)), { status: 500, headers: { "content-type": "text/html; charset=utf-8" } });
    }
  }
  return new Response("Not found", { status: 404 });
}
