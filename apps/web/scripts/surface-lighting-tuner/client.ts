import { Application, Controller } from '@hotwired/stimulus';
import startingSettings from './settings.json';

interface Lighting { strength: number; whiteness: number; position: number; width: number; reach: number; glow: number; glowReach: number; outline: number; }
interface Fill { position: number; width: number; reach: number; light: number; dark: number; }

class ButtonSurfacesController extends Controller {
  static values = { workspaceUrl: String };
  declare workspaceUrlValue: string;
  static targets = ['frame', 'effect', 'panel', 'button', 'theme', 'rimAmount', 'panelAmount', 'buttonAmount', 'actionScope', 'view', 'slider', 'settings', 'composer'];
  declare frameTarget: HTMLIFrameElement;
  declare effectTarget: HTMLSelectElement;
  declare panelTarget: HTMLSelectElement;
  declare buttonTarget: HTMLSelectElement;
  declare themeTarget: HTMLSelectElement;
  declare rimAmountTarget: HTMLInputElement;
  declare panelAmountTarget: HTMLInputElement;
  declare buttonAmountTarget: HTMLInputElement;
  declare actionScopeTarget: HTMLSelectElement;
  declare viewTarget: HTMLSelectElement;
  declare sliderTargets: HTMLInputElement[];
  declare settingsTarget: HTMLTextAreaElement;
  declare composerTarget: HTMLInputElement;

  private get choices(): HTMLSelectElement[] {
    return [this.effectTarget, this.panelTarget, this.buttonTarget, this.themeTarget, this.actionScopeTarget, this.viewTarget];
  }
  private get amounts(): HTMLInputElement[] {
    return [this.rimAmountTarget, this.panelAmountTarget, this.buttonAmountTarget];
  }
  connect(): void {
    for (const control of [...this.amounts, ...this.sliderTargets]) {
      let value: string;
      if (control.dataset.group) {
        // SAFETY: these groups and numeric field names are authored in tuner.html.
        const group = control.dataset.group as 'panels' | 'contentRows' | 'buttonLighting' | 'panelFill' | 'buttonFill' | 'surfaces';
        value = String(Object.entries(startingSettings[group]).find(([name]) => name === control.name)![1]);
      } else {
        // SAFETY: amount targets are the three numeric effect-strength settings.
        value = String(startingSettings[control.name as 'rimAmount' | 'panelAmount' | 'buttonAmount']);
      }
      control.defaultValue = value;
      control.value = value;
    }
    for (const control of this.choices) {
      if (control === this.viewTarget) continue;
      // SAFETY: these select targets are the five authored lighting/theme choices.
      control.value = startingSettings[control.name as 'effect' | 'panel' | 'button' | 'theme' | 'actionScope'];
      control.dataset.initial = control.value;
    }
    const query = new URLSearchParams(location.search);
    for (const control of this.choices) {
      const value = query.get(control.name);
      if ([...control.options].some(option => option.value === value)) control.value = value!;
    }
    for (const control of [...this.amounts, ...this.sliderTargets]) {
      const key = control.dataset.group ? `${control.dataset.group}.${control.name}` : control.name;
      const value = query.get(key);
      if (value !== null && Number.isFinite(Number(value))) control.value = value;
    }
    this.composerTarget.checked = query.has('composerVisible') ? query.get('composerVisible') === 'true' : startingSettings.composerVisible;
    this.showView();
  }
  private value(group: string, name: string): number {
    return Number(this.sliderTargets.find(slider => slider.dataset.group === group && slider.name === name)!.value);
  }
  private lighting(group: string): Lighting {
    return { strength: this.value(group,'strength'), whiteness: this.value(group,'whiteness'), position: this.value(group,'position'), width: this.value(group,'width'), reach: this.value(group,'reach'), glow: this.value(group,'glow'), glowReach: this.value(group,'glowReach'), outline: this.value(group,'outline') };
  }
  private fill(group: string): Fill {
    return { position: this.value(group,'position'), width: this.value(group,'width'), reach: this.value(group,'reach'), light: this.value(group,'light'), dark: this.value(group,'dark') };
  }
  showView(): void {
    const destination = new URL(this.workspaceUrlValue, location.origin);
    destination.searchParams.set('workView', this.viewTarget.value);
    this.frameTarget.src = destination.toString();
    this.update();
  }
  update(): void {
    const panels = this.lighting('panels');
    const contentRows = this.lighting('contentRows');
    const buttons = this.lighting('buttonLighting');
    const panelFill = this.fill('panelFill');
    const buttonFill = this.fill('buttonFill');
    const surfaces = { transcript: this.value('surfaces','transcript'), terminal: this.value('surfaces','terminal'), files: this.value('surfaces','files'), editor: this.value('surfaces','editor'), composer: this.value('surfaces','composer'), other: this.value('surfaces','other') };
    const rim = Number(this.rimAmountTarget.value)/100;
    const panelAmount = Number(this.panelAmountTarget.value)/100;
    const buttonAmount = Number(this.buttonAmountTarget.value)/100;
    for (const control of [...this.amounts, ...this.sliderTargets]) {
      const key = control.dataset.group ? `${control.dataset.group}.${control.name}` : control.name;
      this.element.querySelector<HTMLOutputElement>(`[data-output="${key}"]`)!.value = `${control.value}${control.dataset.unit ?? '%'}`;
    }
    const reflection = (v: Lighting, amount = 1) => `radial-gradient(ellipse ${v.width}% ${v.reach}px at ${v.position}% 0, color-mix(in srgb, color-mix(in srgb, var(--text-muted) ${100-v.whiteness}%, #fff) ${Math.min(100,v.strength*amount)}%, transparent), transparent 85%)`;
    const glow = (v: Lighting, amount = 1) => `radial-gradient(ellipse 80% ${v.glowReach}px at ${v.position}% 0, rgb(255 255 255 / ${Math.min(100,v.glow*amount)}%), transparent 75%)`;
    const outline = (v: Lighting, base = 'var(--panel)') => `linear-gradient(color-mix(in srgb, var(--text-muted) ${v.outline}%, ${base}), color-mix(in srgb, var(--text-muted) ${v.outline}%, ${base}))`;
    const fill = (direction: string, v: Fill, amount: number) => direction === 'pool'
      ? `radial-gradient(ellipse ${v.width}% ${v.reach}px at ${v.position}% 0, rgb(255 255 255 / ${v.light*amount}%), transparent 85%)`
      : direction === 'vertical' ? `linear-gradient(to bottom, rgb(255 255 255 / ${v.light*amount}%), transparent 55%, rgb(0 0 0 / ${v.dark*amount}%))`
      : direction === 'diagonal' ? `linear-gradient(135deg, rgb(255 255 255 / ${v.light*amount}%), transparent 55%, rgb(0 0 0 / ${v.dark*amount}%))`
      : 'linear-gradient(transparent, transparent)';
    const interior = (multiplier: number) => fill(this.panelTarget.value, panelFill, panelAmount*multiplier/100);
    const buttonReflection = this.effectTarget.value === 'b'
      ? `radial-gradient(ellipse ${buttons.width}% 3px at ${buttons.position}% 0, rgb(255 255 255 / ${20*rim}%), transparent 85%), radial-gradient(ellipse ${buttons.width}% 3px at 70% 100%, rgb(0 0 0 / ${12*rim}%), transparent 85%)`
      : `${reflection(buttons,rim)}, ${outline(buttons,'transparent')}`;
    const images = {
      '--panel-inner-glow': glow(panels),
      '--panel-rim-reflection': reflection(panels),
      '--panel-outline': outline(panels),
      '--panel-background-image': fill(this.panelTarget.value,panelFill,panelAmount),
      '--content-row-rim-reflection': reflection(contentRows),
      '--content-row-outline': outline(contentRows),
      '--content-row-inner-glow': glow(contentRows),
      '--button-rim-reflection': buttonReflection,
      '--button-inner-glow': glow(buttons,rim),
      '--button-rim-inset': this.effectTarget.value === 'b' ? '0' : '-1px',
      '--button-lighting-content': this.effectTarget.value === 'none' || this.effectTarget.value === 'c' ? 'none' : '""',
      '--button-engaged-lighting-content': this.effectTarget.value === 'none' ? 'none' : '""',
      '--button-background-image': fill(this.buttonTarget.value,buttonFill,buttonAmount),
      '--transcript-background-image': interior(surfaces.transcript),
      '--terminal-background-image': interior(surfaces.terminal),
      '--files-background-image': interior(surfaces.files),
      '--editor-background-image': interior(surfaces.editor),
      '--composer-background-image': interior(surfaces.composer),
      '--work-background-image': interior(surfaces.other),
    };
    // All production decoration is driven through the design-system lighting roles.
    // Only these two preview-only behavior choices need selectors.
    const css = `:root { ${Object.entries(images).map(([name,value]) => `${name}: ${value};`).join('\n')} }
      ${this.composerTarget.checked ? '' : '.agent-composer-pane > .composer, .agent-composer-pane > .agent-composer-opener { display: none; }'}
      ${this.actionScopeTarget.value === 'all' ? '.content-row { --content-row-reflection: ""; }' : ''}`;
    const documents = [document];
    if (this.frameTarget.contentDocument?.head) documents.push(this.frameTarget.contentDocument);
    for (const doc of documents) {
      doc.documentElement.dataset.theme = this.themeTarget.value;
      let style = doc.getElementById('button-surfaces-tuning');
      if (!style) { style = doc.createElement('style'); style.id = 'button-surfaces-tuning'; doc.head.append(style); }
      style.textContent = css;
    }
    const query = new URLSearchParams();
    for (const control of [...this.choices, ...this.amounts]) query.set(control.name, control.value);
    for (const control of this.sliderTargets) query.set(`${control.dataset.group}.${control.name}`,control.value);
    query.set('composerVisible',String(this.composerTarget.checked));
    history.replaceState(null, '', `?${query}`);
    this.settingsTarget.value = JSON.stringify({composerVisible:this.composerTarget.checked,panels,contentRows,actionScope:this.actionScopeTarget.value,buttonLighting:buttons,panelFill,buttonFill,surfaces,...Object.fromEntries(this.choices.filter(control=>control!==this.actionScopeTarget).map(control=>[control.name,control.value])),...Object.fromEntries(this.amounts.map(control=>[control.name,Number(control.value)]))},null,2);
  }
  reset(): void {
    this.composerTarget.checked = startingSettings.composerVisible;
    for (const control of [...this.amounts,...this.sliderTargets]) control.value=control.defaultValue;
    for (const control of this.choices) control.value=control.dataset.initial!;
    this.showView();
  }
  baseline(): void { this.effectTarget.value='none';this.panelTarget.value='flat';this.buttonTarget.value='flat';this.update(); }
  previous(): void { this.step(-1); }
  next(): void { this.step(1); }
  private step(direction: number): void {
    this.effectTarget.selectedIndex=(this.effectTarget.selectedIndex+direction+this.effectTarget.options.length)%this.effectTarget.options.length;this.update();
  }
  keys(event: KeyboardEvent): void {
    // SAFETY: keydown bubbles from HTML controls in the prototype surface.
    const target=event.target as HTMLElement;
    if(target.matches('input,textarea,select')||target.isContentEditable)return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();this.step(event.key==='ArrowLeft'?-1:1);}
  }
  toggle(event: Event): void {
    // SAFETY: toggle is bound only to the authored native Pinned button.
    const button=event.currentTarget as HTMLButtonElement;
    button.setAttribute('aria-pressed',button.getAttribute('aria-pressed')==='true'?'false':'true');
  }
}
Application.start().register('button-surfaces', ButtonSurfacesController);
