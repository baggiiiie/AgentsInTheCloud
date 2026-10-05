import { readFileSync } from "node:fs";

const letteringSvg = readFileSync(new URL("./lettering.svg", import.meta.url), "utf8");

export function welcomeBrandHtml(): string {
  return `<div class="workspace-empty-welcome-brand" role="img" aria-label="AgentsInTheCloud">${letteringSvg}<img src="/brand/artwork.png" width="2400" height="1260" alt="" aria-hidden="true" /></div>`;
}
