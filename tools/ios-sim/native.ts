import { quote } from './core';

// Native simulator interactions. The caller owns the SSH connection and ensures
// that the UDID belongs to this workspace before passing it here.
export type NativeRemote = (command: string) => Promise<string>;

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Invalid coordinate: ${value}`);
  return String(value);
}

function axe(udid: string, args: string): string {
  return `axe ${args} --udid ${quote(udid)}`;
}

export function describe(remote: NativeRemote, udid: string): Promise<string> {
  return remote(axe(udid, "describe-ui"));
}

export function tap(remote: NativeRemote, udid: string, x: number, y: number): Promise<string> {
  return remote(axe(udid, `tap -x ${number(x)} -y ${number(y)}`));
}

export function swipe(remote: NativeRemote, udid: string, startX: number, startY: number, endX: number, endY: number, duration?: number): Promise<string> {
  return remote(axe(udid, `swipe --start-x ${number(startX)} --start-y ${number(startY)} --end-x ${number(endX)} --end-y ${number(endY)}${duration === undefined ? "" : ` --duration ${number(duration)}`}`));
}

export function typeText(remote: NativeRemote, udid: string, text: string): Promise<string> {
  // stdin handles apostrophes and shell metacharacters without CLI parsing ambiguity.
  return remote(`printf %s ${quote(text)} | ${axe(udid, "type --stdin")}`);
}

export function button(remote: NativeRemote, udid: string, name: string): Promise<string> {
  if (!["apple-pay", "home", "lock", "side-button", "siri"].includes(name)) throw new Error(`Unknown simulator button: ${name}`);
  return remote(axe(udid, `button ${name}`));
}

export async function screenshot(remote: NativeRemote, udid: string): Promise<Uint8Array> {
  const encoded = await remote(`f=$(mktemp /tmp/ios-sim-screenshot.XXXXXXXX.png); trap 'rm -f "$f"' EXIT; ${axe(udid, 'screenshot --output "$f"')} >&2; base64 -i "$f"`);
  return Uint8Array.from(Buffer.from(encoded.trim(), "base64"));
}

interface Element { AXLabel?: string; AXUniqueId?: string; frame?: { x: number; y: number; width: number; height: number }; children?: Element[] }

function findElement(tree: string, label: string, field: "AXLabel" | "AXUniqueId" = "AXLabel"): Element | undefined {
  function search(node: Element): Element | undefined {
    if (node[field] === label) return node;
    for (const child of node.children ?? []) {
      const match = search(child);
      if (match) return match;
    }
  }
  // SAFETY: AXe describe-ui emits an array of accessibility elements.
  const roots = JSON.parse(tree) as Element[];
  for (const root of roots) {
    const match = search(root);
    if (match) return match;
  }
}

function screenSize(tree: string): { width: number; height: number } {
  // SAFETY: AXe describe-ui emits an array of accessibility elements.
  const root = (JSON.parse(tree) as Element[])[0];
  if (!root?.frame) throw new Error(`No screen frame in accessibility tree: ${tree}`);
  return root.frame;
}

// AXe gestures use native screen points, not screenshot/stream pixels. Query at
// gesture time so model changes and rotation do not leave stale geometry.
export async function screenDimensions(remote: NativeRemote, udid: string): Promise<{ width: number; height: number }> {
  return screenSize(await describe(remote, udid));
}

async function waitForLabel(remote: NativeRemote, udid: string, label: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const tree = await describe(remote, udid);
    if (findElement(tree, label)) return tree;
    await Bun.sleep(400);
  }
  throw new Error(`Expected native control ${JSON.stringify(label)} not found. Accessibility tree:\n${await describe(remote, udid)}`);
}

async function tapLabel(remote: NativeRemote, udid: string, label: string): Promise<void> {
  const tree = await waitForLabel(remote, udid, label);
  const frame = findElement(tree, label)?.frame;
  const screen = screenSize(tree);
  if (!frame || frame.width <= 0 || frame.height <= 0 || frame.x < 0 || frame.y < 0 || frame.x + frame.width > screen.width || frame.y + frame.height > screen.height)
    throw new Error(`Native control ${JSON.stringify(label)} is not visible on the screen. Accessibility tree:\n${tree}`);
  await tap(remote, udid, frame.x + frame.width / 2, frame.y + frame.height / 2);
}

export async function dismissSafariOnboarding(remote: NativeRemote, udid: string): Promise<boolean> {
  // simctl bootstatus can finish before AXe's simulator automation service is ready.
  let initial = '';
  for (let attempt=0;attempt<20;attempt++) {
    try { initial=await describe(remote, udid); break; }
    catch(error) {
      if (!String(error).includes('Timed out creating the simulator remote automation session') || attempt===19) throw error;
      await Bun.sleep(1000);
    }
  }
  if (!findElement(initial, "Start Page")) return false;
  if (findElement(initial, "Close")) await tapLabel(remote, udid, "Close");
  else if (findElement(initial, "close")) await tapLabel(remote, udid, "close");
  else throw new Error(`Safari Start Page onboarding has no Close control. Accessibility tree:\n${initial}`);
  return true;
}

export async function installPwa(remote: NativeRemote, udid: string, url: string): Promise<string> {
  await remote(`xcrun simctl openurl ${quote(udid)} ${quote(url)}`);
  // Fresh Safari can cover the first navigation with its Start Page onboarding.
  if (await dismissSafariOnboarding(remote, udid)) await remote(`xcrun simctl openurl ${quote(udid)} ${quote(url)}`);
  await tapLabel(remote, udid, "Page Menu");
  await tapLabel(remote, udid, "Share");

  // On iOS 27 the share sheet's actions are opaque to AXe: only its
  // "dismiss popup" element appears. These positions were measured on the
  // iPhone 17 and are scaled to the simulator's accessibility screen frame.
  const sheet = await waitForLabel(remote, udid, "dismiss popup");
  const { width, height } = screenSize(sheet);
  await tap(remote, udid, width * 331 / 402, height * 779 / 874); // View More
  if (!findElement(await describe(remote, udid), "dismiss popup")) throw new Error("Share sheet closed instead of expanding");
  await tap(remote, udid, width * 180 / 402, height * 636 / 874); // Add to Home Screen
  // The add sheet briefly exposes its buttons through accessibility, then
  // becomes an opaque remote view. Its unique ID remains available to verify
  // the correct screen before using the Add button's top-right coordinates.
  let addSheet: string | undefined;
  for (let i = 0; i < 20; i++) {
    const tree = await describe(remote, udid);
    if (findElement(tree, "AddToHomeScreenView", "AXUniqueId")) { addSheet = tree; break; }
    await Bun.sleep(400);
  }
  if (!addSheet) throw new Error(`Add to Home Screen sheet did not appear. Accessibility tree:\n${await describe(remote, udid)}`);
  await Bun.sleep(500); // Let the remote Add sheet finish its entrance animation.
  let dismissed = false;
  for (let attempt=0;attempt<3 && !dismissed;attempt++) {
    if (!findElement(await describe(remote, udid), "AddToHomeScreenView", "AXUniqueId")) throw new Error('Add sheet changed before tapping Add');
    await tap(remote, udid, width * 351 / 402, height * 100 / 874); // Add
    for (let i=0;i<5;i++) {
      await Bun.sleep(350);
      if (!findElement(await describe(remote, udid), "AddToHomeScreenView", "AXUniqueId")) { dismissed=true; break; }
    }
  }
  if (!dismissed) throw new Error('Add to Home Screen sheet did not close after three verified taps');
  await Bun.sleep(800); // SpringBoard registers the new web clip asynchronously.
  await button(remote, udid, "home");
  return await describe(remote, udid);
}

export async function launchPwa(remote: NativeRemote, udid: string, title: string): Promise<string> {
  await button(remote, udid, "home");
  await Bun.sleep(600); // SpringBoard must finish its page transition before accessibility frames settle.
  for (let page = 0; page < 8; page++) {
    const tree = await describe(remote, udid);
    const screen = screenSize(tree);
    const frame = findElement(tree, title)?.frame;
    if (frame && frame.width > 0 && frame.height > 0 && frame.x >= 0 && frame.x + frame.width <= screen.width && frame.y >= 0 && frame.y + frame.height <= screen.height) {
      await tap(remote, udid, frame.x + frame.width / 2, frame.y + frame.height / 2);
      return await describe(remote, udid);
    }
    await swipe(remote, udid, screen.width * 0.85, screen.height * 0.55, screen.width * 0.12, screen.height * 0.55, 0.3);
    await Bun.sleep(600);
  }
  throw new Error(`PWA ${JSON.stringify(title)} was not found on the first eight Home Screen pages`);
}
