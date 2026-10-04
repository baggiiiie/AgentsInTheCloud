/** Physical positions run left-to-right on either text direction. Native RTL
 * scrollLeft instead runs from -maximum to zero; keep that conversion shared. */
export function scrollGeometry(viewport: HTMLElement, axis: number) {
  const style = getComputedStyle(viewport);
  const size = axis ? viewport.clientHeight : viewport.clientWidth;
  const total = axis ? viewport.scrollHeight : viewport.scrollWidth;
  const maximum = Math.max(0, total - size);
  const reversed = !axis && style.direction === "rtl";
  const nativePosition = axis ? viewport.scrollTop : viewport.scrollLeft;
  return {
    size, total, maximum, reversed,
    position: Math.max(0, Math.min(maximum, reversed ? maximum + nativePosition : nativePosition)),
    scrollable: viewport === document.documentElement || /auto|scroll/.test(axis ? style.overflowY : style.overflowX),
  };
}

export function setScrollPosition(viewport: HTMLElement, axis: number, position: number): void {
  const { maximum, reversed } = scrollGeometry(viewport, axis);
  const next = Math.max(0, Math.min(maximum, position));
  if (axis) viewport.scrollTop = next;
  else viewport.scrollLeft = reversed ? next - maximum : next;
}
