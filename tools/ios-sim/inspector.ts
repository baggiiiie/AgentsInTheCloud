/** WebKit Inspector access for one booted iOS simulator. The proxy is owned by serve. */
export type InspectorTarget = {
  title: string;
  url: string;
  appId: string;
  webSocketDebuggerUrl: string;
  pwa: boolean;
};

export type ElementInfo = {
  tag: string;
  text: string;
  html: string;
  rect: { x: number; y: number; width: number; height: number };
};

export type TouchElement = {
  rect: ElementInfo['rect'];
  viewport: { width: number; height: number; screenWidth: number; screenHeight: number; devicePixelRatio: number; standalone: boolean; visualWidth: number; visualHeight: number; visualOffsetLeft: number; visualOffsetTop: number; visualScale: number };
};

type ProtocolMessage = { id?: number; method?: string; params?: any; result?: any; error?: { message: string } };

function targetExpression(selector: string, body: string): string {
  return `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('No element matches selector: ' + ${JSON.stringify(selector)}); ${body} })()`;
}

/** Reject ambiguous native taps, e.g. tapping an entire tab containing a close button. */
export function assertTouchTarget(selector: string): string {
  return targetExpression(selector, `if (element.querySelector('a, button, input, select, textarea, summary, [role="button"], [role="link"], [onclick], [tabindex]:not([tabindex="-1"])')) throw new Error('Refusing touch: element contains interactive descendants'); const r = element.getBoundingClientRect(); if (!r.width || !r.height) throw new Error('Element has no visible bounds'); const cx = r.x + r.width / 2, cy = r.y + r.height / 2; if (cx < visualViewport.offsetLeft || cx > visualViewport.offsetLeft + visualViewport.width || cy < visualViewport.offsetTop || cy > visualViewport.offsetTop + visualViewport.height) throw new Error('Refusing touch: element centre is outside the visible viewport; scroll it into view first'); return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, viewport: { width: innerWidth, height: innerHeight, screenWidth: screen.width, screenHeight: screen.height, devicePixelRatio: devicePixelRatio, standalone: !!navigator.standalone, visualWidth: visualViewport.width, visualHeight: visualViewport.height, visualOffsetLeft: visualViewport.offsetLeft, visualOffsetTop: visualViewport.offsetTop, visualScale: visualViewport.scale } };`);
}

/** A single connection to a page: the proxy wraps WebKit commands inside Target messages. */
class PageConnection {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private pageId: string | undefined;
  private ready: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private events: ProtocolMessage[] = [];

  constructor(url: string) {
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {}; // Target.targetCreated arrives after opening.
    this.ws.onmessage = (event) => {
      // SAFETY: Inspector websocket messages follow the WebKit protocol envelope.
      const envelope = JSON.parse(String(event.data)) as ProtocolMessage;
      if (envelope.method === 'Target.targetCreated') {
        this.pageId = envelope.params.targetInfo.targetId;
        this.readyResolve();
      } else if (envelope.method === 'Target.dispatchMessageFromTarget') {
        this.receive(JSON.parse(envelope.params.message));
      } else if (envelope.error) {
        this.fail(envelope.error.message);
      }
    };
    this.ws.onerror = () => this.fail('Web Inspector connection failed');
    this.ws.onclose = () => this.fail('Web Inspector connection closed');
  }

  private fail(message: string) {
    const error = new Error(message);
    this.readyReject(error);
    for (const item of this.pending.values()) item.reject(error);
    this.pending.clear();
  }

  private receive(message: ProtocolMessage) {
    if (message.id !== undefined) {
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    } else this.events.push(message);
  }

  async send(method: string, params: { expression?: string; returnByValue?: boolean; awaitPromise?: boolean } = {}): Promise<any> {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id: this.nextId++, method: 'Target.sendMessageToTarget', params: { targetId: this.pageId, message: JSON.stringify({ id, method, params }) } }));
    return await result;
  }

  async evaluate(expression: string): Promise<any> {
    const { result, wasThrown } = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (wasThrown) throw new Error(result.description || result.value || 'JavaScript evaluation failed');
    return result.value;
  }

  async consoleMessages(): Promise<any[]> {
    await this.send('Console.enable');
    // Enabling Console replays buffered messages from WebKit.
    return this.events.filter((event) => event.method === 'Console.messageAdded').map((event) => event.params.message);
  }

  close() { this.ws.close(); }
}

export class WebInspector {
  constructor(readonly port: number) {}

  async targets(): Promise<InspectorTarget[]> {
    const response = await fetch(`http://127.0.0.1:${this.port}/json`);
    if (!response.ok) throw new Error(`Web Inspector target listing failed: HTTP ${response.status}`);
    // SAFETY: the proxy's /json endpoint returns the WebKit target listing.
    const items = await response.json() as Omit<InspectorTarget, 'pwa'>[];
    const targets: InspectorTarget[] = [];
    for (const item of items) {
      const page = new PageConnection(item.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${this.port}`));
      try {
        targets.push({ ...item, pwa: await page.evaluate('navigator.standalone === true') === true });
      } finally { page.close(); }
    }
    return targets;
  }

  private async page(target?: string): Promise<PageConnection> {
    for(let attempt=0;attempt<120;attempt++) {
      const targets = await this.targets();
      const matching = target === 'pwa' ? targets.filter((item) => item.pwa)
        : target ? targets.filter((item) => item.url.includes(target)) : targets;
      if (matching.length === 1) return new PageConnection(matching[0]!.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${this.port}`));
      if (matching.length > 1 || attempt===119) throw new Error(`Expected one Web Inspector target, found ${matching.length}. Choose with --target; available: ${targets.map((item) => `${item.pwa ? 'PWA ' : ''}${item.title} ${item.url}`).join(', ')}`);
      await Bun.sleep(250);
    }
    throw new Error('Web Inspector target did not appear');
  }

  private async withPage<T>(target: string | undefined, action: (page: PageConnection) => Promise<T>): Promise<T> {
    const page = await this.page(target);
    try { return await action(page); } finally { page.close(); }
  }

  async eval(expression: string, target?: string): Promise<any> {
    return this.withPage(target, (page) => page.evaluate(expression));
  }

  async query(selector: string, target?: string): Promise<ElementInfo | null> {
    return this.eval(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; const r = element.getBoundingClientRect(); return { tag: element.tagName.toLowerCase(), text: element.textContent?.trim() || '', html: element.outerHTML, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }; })()`, target);
  }

  async waitFor(selector: string, target?: string, timeout = 10000): Promise<ElementInfo> {
    const deadline = Date.now() + timeout;
    while (true) {
      const element = await this.query(selector, target);
      if (element) return element;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${selector}`);
      await Bun.sleep(Math.min(250, deadline - Date.now()));
    }
  }

  async click(selector: string, target?: string): Promise<void> {
    await this.eval(targetExpression(selector, `element.click();`), target);
  }

  async fill(selector: string, text: string, target?: string): Promise<void> {
    await this.eval(targetExpression(selector, `element.focus(); const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set; if (!setter) throw new Error('Element cannot be filled'); setter.call(element, ${JSON.stringify(text)}); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));`), target);
  }

  async touchRect(selector: string, target?: string): Promise<TouchElement> {
    return this.eval(assertTouchTarget(selector), target);
  }

  async logs(target?: string): Promise<any[]> {
    return this.withPage(target, (page) => page.consoleMessages());
  }
}

/** Start one proxy under the SSH ControlMaster owned by serve. Caller stops the subprocess. */
export async function startInspectorProxy(
  udid: string,
  localPort: number,
  remotePort: number,
  runRemote: (command: string) => Promise<string>,
  spawnRemote: (command: string, forward: { local: number; remote: number }) => Bun.Subprocess,
): Promise<{ inspector: WebInspector; process: Bun.Subprocess }> {
  const socket = (await runRemote(inspectorSocketCommand(udid))).trim();
  const process = spawnRemote(inspectorProxyCommand(socket, remotePort), { local: localPort, remote: remotePort });
  const inspector = new WebInspector(localPort);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (process.exitCode !== null) throw new Error(`Inspector proxy exited with code ${process.exitCode}`);
    try {
      await inspector.targets();
      return { inspector, process };
    } catch (error) {
      // Proxy needs time to bind its listener. A live proxy with no pages is valid.
      if (!(error instanceof TypeError)) throw error;
      await Bun.sleep(100);
    }
  }
  process.kill();
  throw new Error(`Timed out starting Web Inspector proxy for ${udid}`);
}

/** Find this simulator's socket. Never pick the first socket: other simulators may be booted. */
export function inspectorSocketCommand(udid: string): string {
  if (!/^[A-Fa-f0-9-]{36}$/.test(udid)) throw new Error(`Invalid simulator UDID: ${udid}`);
  return `pid=$(ps -axo pid=,command= | grep '[l]aunchd_sim .*${udid}/data/var/run/launchd_bootstrap.plist' | awk '{print $1}'); test -n "$pid" || { echo 'Simulator launchd_sim not found' >&2; exit 1; }; lsof -n -U -a -p "$pid" | awk '/com\\.apple\\.webinspectord_sim\\.socket/ { print $NF; exit }'`;
}

/** Remote command to run a per-simulator proxy; caller arranges SSH -L and owns the process. */
export function inspectorProxyCommand(socket: string, remotePort: number): string {
  if (!socket.startsWith('/') || !socket.endsWith('/com.apple.webinspectord_sim.socket')) throw new Error(`Invalid inspector socket: ${socket}`);
  return `exec ios_webkit_debug_proxy -s ${JSON.stringify(`unix:${socket}`)} -c ${JSON.stringify(`null:${remotePort - 1},:${remotePort}`)} -F`;
}
