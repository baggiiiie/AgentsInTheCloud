import { Application, Controller } from '@hotwired/stimulus';

interface LightingValues { strength: number; whiteness: number; position: number; width: number; reach: number; glow: number; glowReach: number; outline: number; }

class PanelLightController extends Controller {
  static targets = ['frame', 'slider', 'settings', 'scope'];
  declare frameTarget: HTMLIFrameElement;
  declare sliderTargets: HTMLInputElement[];
  declare settingsTarget: HTMLTextAreaElement;
  declare scopeTarget: HTMLSelectElement;

  update(): void {
    const initial: LightingValues = { strength: 0, whiteness: 0, position: 0, width: 0, reach: 0, glow: 0, glowReach: 0, outline: 0 };
    const groups = { panels: { ...initial }, actionItems: { ...initial } };
    for (const slider of this.sliderTargets) {
      const output = this.element.querySelector<HTMLOutputElement>(`[data-output="${slider.dataset.group}-${slider.name}"]`)!;
      output.value = `${slider.value}${slider.dataset.unit}`;
      const group = slider.dataset.group === 'panels' ? groups.panels : groups.actionItems;
      // SAFETY: slider names are authored from the lighting controls in the prototype.
      group[slider.name as keyof LightingValues] = Number(slider.value);
    }
    const document = this.frameTarget.contentDocument!;
    let style = document.getElementById('panel-light-tuning');
    if (!style) {
      style = document.createElement('style');
      style.id = 'panel-light-tuning';
      document.head.append(style);
    }
    const panel = groups.panels;
    const item = groups.actionItems;
    const reflection = (v: LightingValues) => `radial-gradient(ellipse ${v.width}% ${v.reach}px at ${v.position}% 0,
      color-mix(in srgb, color-mix(in srgb, var(--text-muted) ${100-v.whiteness}%, #fff) ${v.strength}%, transparent), transparent 85%)`;
    const glow = (v: LightingValues) => `radial-gradient(ellipse 80% ${v.glowReach}px at ${v.position}% 0, rgb(255 255 255 / ${v.glow}%), transparent 75%)`;
    const outline = (v: LightingValues) => `linear-gradient(color-mix(in srgb, var(--text-muted) ${v.outline}%, var(--panel)), color-mix(in srgb, var(--text-muted) ${v.outline}%, var(--panel)))`;
    const selected = '.action-item:has(> .action-item__primary:is([aria-current]:not([aria-current="false"]), [aria-selected="true"], [aria-checked="true"]))';
    const active = '.action-item:is(:hover, :focus-visible, :has(:focus-visible), [aria-current]:not([aria-current="false"]), [aria-selected="true"], [aria-checked="true"])';
    const selector = this.scopeTarget.value === 'all' ? '.action-item' : `${selected}, ${active}`;
    style.textContent = `.panel { background:
      ${glow(panel)} padding-box,
      linear-gradient(var(--panel), var(--panel)) padding-box,
      ${reflection(panel)} border-box, ${outline(panel)} border-box;
    }
    .action-item { position: relative; }
    :is(${selector})::before {
      content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
      background: ${reflection(item)}, ${outline(item)};
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask-composite: exclude;
    }
    :is(${selector})::after {
      content: ''; position: absolute; inset: 1px; border-radius: inherit; pointer-events: none;
      background: ${glow(item)};
    }`;
    this.settingsTarget.value = JSON.stringify({ ...groups, actionScope: this.scopeTarget.value }, null, 2);
  }

  reset(): void {
    for (const slider of this.sliderTargets) slider.value = slider.defaultValue;
    this.scopeTarget.value = 'engaged';
    this.update();
  }
}
Application.start().register('panel-light', PanelLightController);
