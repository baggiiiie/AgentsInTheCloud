import { Icons } from "../icons/icons-html.ts";

/** Accent circle with a plus that leads rows which create something, set apart from the rows' own icons. Decorative: the row's label names the action. */
export function addBadgeHtml(): string {
  return `<span class="add-badge" aria-hidden="true">${Icons.Plus}</span>`;
}
