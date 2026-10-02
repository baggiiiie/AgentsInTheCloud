import { agentsInTheCloudLogoPathsHtml, Icons } from "@agents-in-the-cloud/design-system/icons";

/** The normal mark remains the click target; the clipped scene is decorative. */
export function agentsInTheCloudEasterEggHtml(): string {
  const clipId = `agents-in-the-cloud-logo-clip-${crypto.randomUUID()}`;
  return `<span class="agents-in-the-cloud-easter-egg" data-controller="agents-in-the-cloud-easter-egg" data-action="keydown.esc@window->agents-in-the-cloud-easter-egg#reset resize@window->agents-in-the-cloud-easter-egg#reset turbo:before-cache@document->agents-in-the-cloud-easter-egg#reset">
    <button class="agents-in-the-cloud-easter-egg__trigger" type="button" aria-label="Animate AgentsInTheCloud logo" data-action="agents-in-the-cloud-easter-egg#play">
      <span class="agents-in-the-cloud-easter-egg__rest" data-agents-in-the-cloud-easter-egg-target="rest">${Icons.AgentsInTheCloud}</span>
    </button>
    <svg class="agents-in-the-cloud-easter-egg__actor" data-agents-in-the-cloud-easter-egg-target="actor" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <ellipse class="agents-in-the-cloud-easter-egg__portal agents-in-the-cloud-easter-egg__portal--bottom" cx="12" cy="31" rx="17" ry="3"/>
      <ellipse class="agents-in-the-cloud-easter-egg__portal agents-in-the-cloud-easter-egg__portal--top" cx="12" cy="-14" rx="17" ry="3"/>
      <defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="-20" y="-16" width="64" height="48"/></clipPath></defs>
      <g clip-path="url(#${clipId})">
        <g class="agents-in-the-cloud-easter-egg__performer" data-action="animationend->agents-in-the-cloud-easter-egg#finish">
          ${agentsInTheCloudLogoPathsHtml}
          <g class="agents-in-the-cloud-easter-egg__eyes">
            <ellipse cx="9" cy="10" rx="3.2" ry="4"/>
            <ellipse cx="16" cy="10" rx="3.2" ry="4"/>
            <g class="agents-in-the-cloud-easter-egg__pupils"><circle cx="9" cy="10" r="1.2"/><circle cx="16" cy="10" r="1.2"/></g>
          </g>
          <g class="agents-in-the-cloud-easter-egg__panic">
            <ellipse class="agents-in-the-cloud-easter-egg__mouth" cx="12" cy="18" rx="2.7" ry="4"/>
            <path d="M5 14-2 6-6 3M19 14 26 6 30 3"/>
          </g>
        </g>
      </g>
    </svg>
  </span>`;
}
