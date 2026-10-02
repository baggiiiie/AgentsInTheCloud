// Throwaway browser-owned playground; production renderers supplied the HTML.
import { Application, Controller } from '@hotwired/stimulus';
import { registerDesignSystemControllers } from '../../../../packages/design-system/src/client.ts';
import { setActionItemLabel } from '../../../../packages/design-system/src/action-item/action-item-controller.ts';

class PlaygroundController extends Controller<HTMLElement> {
  active!: HTMLElement;
  timer!: ReturnType<typeof setInterval>;
  modeValue = 'b';
  drag: { track: HTMLElement; strip: HTMLElement; x: number; scroll: number } | null = null;
  connect() {
    this.active = this.element.querySelector<HTMLElement>('[data-pane=agent] .action-item')!;
    this.modeValue = new URL(location.href).searchParams.get('variant') === 'a' ? 'a' : 'b';
    this.applyMode(); this.count();
    for (const pane of this.panes) {
      const tabs = [...pane.querySelectorAll<HTMLElement>('[data-tab-index]')];
      this.setStatus(tabs[0]!, true, false);
      this.setStatus(tabs[2]!, true, true);
    }
    this.syncControls(); this.measure();
    this.timer = setInterval(() => this.measure(), 150);
  }
  disconnect() { clearInterval(this.timer); }
  get panes() { return [...this.element.querySelectorAll<HTMLElement>('[data-pane]')]; }
  input(selector: string) { return this.element.querySelector<HTMLInputElement>(selector)!; }
  applyMode() {
    this.element.dataset.variant = this.modeValue;
    this.element.querySelector<HTMLSelectElement>('[data-mode]')!.value = this.modeValue;
    this.element.querySelector('[data-rationale]')!.textContent = this.modeValue === 'a'
      ? 'A · Current: Agent uses a 6rem-minimum grid and scrolls its actions away. Work shrinks tabs to 9.5rem, then scrolls only tabs.'
      : 'B · Candidate: short tabs hug their content; long tabs shrink to 7rem before scrolling. Hover/focus reveals an overlay scrollbar without moving the tabs. Edge fades mark clipped tabs and titles; header actions stay put.';
    const url = new URL(location.href); url.searchParams.set('variant', this.modeValue); history.replaceState(null, '', url);
  }
  mode(event: Event) {
    // SAFETY: The action is bound to the behaviour select.
    this.modeValue = (event.target as HTMLSelectElement).value; this.applyMode();
  }
  previous() { this.modeValue = this.modeValue === 'a' ? 'b' : 'a'; this.applyMode(); }
  next() { this.previous(); }
  keys(event: KeyboardEvent) {
    // SAFETY: Key events originate in the document’s HTML controls.
    if ((event.target as HTMLElement).closest('input, select, textarea, button, [role=tablist], [role=scrollbar]')) return;
    if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); this.next(); }
  }
  theme(event: Event) {
    // SAFETY: The action is bound to the theme select.
    document.documentElement.dataset.theme = (event.target as HTMLSelectElement).value;
  }
  width() {
    const width = this.input('[data-width]').value;
    for (const pane of this.panes) { const region = pane.querySelector<HTMLElement>('.pane-width')!; region.style.width = `${width}px`; }
    this.element.querySelector('[data-width-label]')!.textContent = `${width} px`;
  }
  count() {
    const count = Number(this.input('[data-count]').value);
    this.element.querySelector('[data-count-label]')!.textContent = String(count);
    for (const pane of this.panes) {
      const tabs = [...pane.querySelectorAll<HTMLElement>('[data-tab-index]')];
      tabs.forEach((tab, index) => { tab.hidden = index >= count; });
      if (!tabs.some(tab => !tab.hidden && tab.querySelector('[aria-selected=true]'))) this.selectItem(tabs[0]!);
    }
    if (this.active.hidden) this.active = this.active.closest('[data-pane]')!.querySelector<HTMLElement>('[data-tab-index]:not([hidden])')!;
    this.syncControls();
  }
  select(event: Event) {
    // SAFETY: The action is bound to a tab button; its target is an HTML descendant.
    this.active = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-index]')!; this.selectItem(this.active); this.syncControls();
  }
  selectItem(item: HTMLElement) {
    const pane = item.closest('[data-pane]')!;
    for (const tab of pane.querySelectorAll('[role=tab]')) tab.setAttribute('aria-selected', String(tab === item.querySelector('[role=tab]')));
    pane.querySelector('[data-active-title]')!.textContent = item.querySelector('.action-item__label-text')!.textContent;
  }
  syncControls() {
    this.input('[data-title]').value = this.active.querySelector('.action-item__label-text')!.textContent!;
    this.input('[data-busy-control]').checked = !this.active.querySelector<HTMLElement>('[data-busy]')!.hidden;
    this.input('[data-attention-control]').checked = !this.active.querySelector<HTMLElement>('[data-attention]')!.hidden;
    this.input('[data-title]').closest('.control-row')!.querySelector('strong')!.textContent = `Selected ${this.active.closest<HTMLElement>('[data-pane]')!.dataset.pane} tab`;
  }
  title() { setActionItemLabel(this.active, this.input('[data-title]').value); this.selectItem(this.active); }
  status() { this.setStatus(this.active, this.input('[data-busy-control]').checked, this.input('[data-attention-control]').checked); }
  setStatus(item: HTMLElement, busy: boolean, attention: boolean) {
    item.querySelector<HTMLElement>('[data-busy]')!.hidden = !busy;
    item.querySelector<HTMLElement>('[data-attention]')!.hidden = !attention;
    item.querySelector<HTMLElement>('[data-state-slot]')!.hidden = !busy && !attention;
    item.querySelector('[role=tab]')!.setAttribute('aria-busy', String(busy));
  }
  mixed() { for (const pane of this.panes) pane.querySelectorAll<HTMLElement>('[data-tab-index]').forEach((item,i) => this.setStatus(item, i === 0 || i === 2, i === 1 || i === 2)); this.syncControls(); }
  closeControls(event: Event) {
    // SAFETY: The action is bound to the hover-controls checkbox.
    this.element.toggleAttribute('data-no-close', !(event.target as HTMLInputElement).checked);
  }
  closeTab(event: Event) {
    event.preventDefault();
    // SAFETY: The submit event targets the close form inside a tab.
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-index]')!;
    const next = [...item.closest('[data-pane]')!.querySelectorAll<HTMLElement>('[data-tab-index]')].find(tab => tab !== item && !tab.hidden);
    if (!next) { this.noticeText('Keep one tab open for inspection.'); return; }
    item.hidden = true;
    if (item.querySelector('[aria-selected=true]')) { this.active = next; this.selectItem(next); this.syncControls(); }
  }
  addTab(event: Event) {
    // SAFETY: The action is bound to a pane’s add button; SVG targets are Elements too.
    const pane = (event.target as HTMLElement).closest('[data-pane]')!;
    const next = pane.querySelector<HTMLElement>('[data-tab-index][hidden]');
    if (next) { next.hidden = false; this.active = next; this.selectItem(next); this.syncControls(); }
    else this.noticeText('All five demo tabs are already open.');
  }
  notice(event: Event) {
    // SAFETY: Stimulus invokes this action with the HTML button as currentTarget.
    this.noticeText(`${(event.currentTarget as HTMLElement).getAttribute('aria-label')} clicked — no workspace changes.`);
  }
  noticeText(text: string) { this.element.querySelector('[data-notice]')!.textContent = text; }
  reset() { location.reload(); }
  wheel(event: WheelEvent) {
    if (this.modeValue !== 'b' || event.ctrlKey) return;
    if (!(event.target instanceof Element)) return;
    // Keep horizontal trackpad gestures native; translate vertical mouse wheels.
    if (event.deltaX !== 0 && !event.shiftKey) return;
    const strip = event.target.closest('.strip-wrap')?.querySelector<HTMLElement>('.tab-strip');
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const delta = event.deltaX || event.deltaY;
    const atEnd = strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 1;
    if ((delta > 0 && atEnd) || (delta < 0 && strip.scrollLeft <= 0)) return;
    event.preventDefault();
    strip.scrollLeft += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1);
    this.measure();
  }
  dragStart(event: PointerEvent) {
    if (event.button !== 0) return;
    // SAFETY: This pointer action is bound to the overlay scrollbar track.
    const track = event.currentTarget as HTMLElement;
    const strip = track.parentElement!.querySelector<HTMLElement>('.tab-strip')!;
    const thumb = track.firstElementChild!.getBoundingClientRect();
    if (event.clientX < thumb.left || event.clientX > thumb.right) {
      const travel = track.clientWidth - thumb.width;
      strip.scrollLeft = ((event.clientX - track.getBoundingClientRect().left - thumb.width / 2) / travel) * (strip.scrollWidth - strip.clientWidth);
    }
    this.drag = { track, strip, x: event.clientX, scroll: strip.scrollLeft };
    track.setPointerCapture(event.pointerId);
    track.toggleAttribute('data-dragging', true);
    event.preventDefault(); this.measure();
  }
  dragMove(event: PointerEvent) {
    if (!this.drag) return;
    const { track, strip, x, scroll } = this.drag;
    const travel = track.clientWidth - track.firstElementChild!.getBoundingClientRect().width;
    strip.scrollLeft = scroll + (event.clientX - x) * (strip.scrollWidth - strip.clientWidth) / travel;
    this.measure();
  }
  dragEnd() {
    if (!this.drag) return;
    this.drag.track.removeAttribute('data-dragging');
    this.drag = null;
  }
  scrollKey(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    // SAFETY: This key action is bound to the overlay scrollbar track.
    const track = event.currentTarget as HTMLElement;
    const strip = track.parentElement!.querySelector<HTMLElement>('.tab-strip')!;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home') strip.scrollLeft = 0;
    else if (event.key === 'End') strip.scrollLeft = strip.scrollWidth;
    else strip.scrollLeft += event.key === 'ArrowRight' ? 64 : -64;
    this.measure();
  }
  measure() {
    const lines: string[] = [];
    for (const pane of this.panes) {
      const strip = pane.querySelector<HTMLElement>('.tab-strip')!;
      for (const tab of strip.querySelectorAll<HTMLElement>('[data-tab-index]:not([hidden])')) {
        const text = tab.querySelector<HTMLElement>('.action-item__label-text')!;
        const range = document.createRange(); range.selectNodeContents(text);
        const iconWidth = tab.querySelector('.action-item__icon')!.getBoundingClientRect().width;
        const stateSlot = tab.querySelector<HTMLElement>('[data-state-slot]')!;
        // Size from state, not hover visibility: hiding status must not resize tabs.
        const slotWidth = stateSlot.hidden ? 0 : parseFloat(getComputedStyle(stateSlot.querySelector('.status-indicator')!).width);
        const primary = tab.querySelector<HTMLElement>('.action-item__primary')!;
        const itemStyle = getComputedStyle(tab);
        const primaryStyle = getComputedStyle(primary);
        const padding = [itemStyle.paddingInlineStart, itemStyle.paddingInlineEnd, primaryStyle.paddingInlineStart, primaryStyle.paddingInlineEnd]
          .reduce((sum, value) => sum + parseFloat(value), 0);
        const gaps = parseFloat(primaryStyle.columnGap) * (slotWidth ? 2 : 1);
        const naturalWidth = Math.ceil(range.getBoundingClientRect().width + iconWidth + slotWidth + padding + gaps);
        tab.style.setProperty('--prototype-tab-width', `${Math.min(320, naturalWidth)}px`);
        tab.style.setProperty('--prototype-tab-min', `${Math.min(112, naturalWidth)}px`);
      }
      strip.toggleAttribute('data-cut-right', strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1);
      strip.toggleAttribute('data-cut-left', strip.scrollLeft > 1);
      const track = pane.querySelector<HTMLElement>('.overlay-scrollbar')!;
      const overflow = strip.scrollWidth - strip.clientWidth;
      const thumbWidth = Math.max(28, track.clientWidth * strip.clientWidth / strip.scrollWidth);
      track.toggleAttribute('data-overflow', overflow > 1);
      track.tabIndex = this.modeValue === 'b' && overflow > 1 ? 0 : -1;
      track.style.setProperty('--thumb-width', `${thumbWidth}px`);
      track.style.setProperty('--thumb-offset', `${overflow > 0 ? strip.scrollLeft / overflow * (track.clientWidth - thumbWidth) : 0}px`);
      track.setAttribute('aria-valuemax', String(Math.max(0, overflow)));
      track.setAttribute('aria-valuenow', String(Math.round(strip.scrollLeft)));
      for (const tab of strip.querySelectorAll<HTMLElement>('[data-tab-index]:not([hidden])')) {
        const viewport = tab.querySelector<HTMLElement>('.action-item__label')!;
        const text = tab.querySelector<HTMLElement>('.action-item__label-text')!;
        const range = document.createRange(); range.selectNodeContents(text);
        const bounds = range.getBoundingClientRect();
        const edge = viewport.getBoundingClientRect();
        tab.toggleAttribute('data-title-cut-right', bounds.right > edge.right + 1);
        tab.toggleAttribute('data-title-cut-left', bounds.left < edge.left - 1);
      }
      const scroll = pane.dataset.pane === 'agent' && this.modeValue === 'a' ? pane.querySelector<HTMLElement>('.agent-scroll')! : strip;
      const tab = pane.querySelector<HTMLElement>('[data-tab-index]:not([hidden]):has([aria-selected=true])')!;
      const hovered = pane.querySelector<HTMLElement>('[data-tab-index]:hover');
      const item = hovered ?? tab;
      const label = item.querySelector<HTMLElement>('.action-item__label')!;
      const text = item.querySelector<HTMLElement>('.action-item__label-text')!;
      const width = Math.round(item.getBoundingClientRect().width);
      pane.querySelector('[data-metrics]')!.textContent = `${Math.round(pane.querySelector('.pane-width')!.getBoundingClientRect().width)}px · ${scroll.scrollWidth > scroll.clientWidth + 1 ? 'overflow → scroll' : 'fits'}`;
      const widths = [...strip.querySelectorAll<HTMLElement>('[data-tab-index]:not([hidden])')].map(tab => Math.round(tab.getBoundingClientRect().width)).join(' / ');
      lines.push(`${pane.dataset.pane!.toUpperCase()} · ${hovered ? 'hovered' : 'selected'} tab ${width}px | title viewport ${label.clientWidth}px / text ${text.scrollWidth}px | ${item.classList.contains('is-label-scrolling') ? 'title scrolling' : text.scrollWidth > label.clientWidth ? 'truncated' : 'full title'} | scroll ${Math.round(scroll.scrollLeft)}/${scroll.scrollWidth - scroll.clientWidth}px | tab widths ${widths}px`);
    }
    this.element.querySelector('[data-readout]')!.textContent = lines.join('\n');
  }
}
const application = Application.start();
application.register('playground', PlaygroundController);
registerDesignSystemControllers(application);
