import type { ButtonOptions } from "../button/button-html.ts";
import { buttonConfirmationMarkup } from "./button-confirmation-markup.ts";

export interface ButtonConfirmationOptions extends ButtonOptions {
  /** Accessible acknowledgement, such as “Changes saved” or “Copied to clipboard”. */
  confirmationLabel: string;
  /** Render a completed action directly in its confirmation state. */
  confirmed?: boolean;
  /** Optional descriptive accessible name and tooltip for a captioned control. */
  label?: string;
}

/** A native button whose content briefly gives way to a centered success check. */
export function buttonConfirmationHtml(options: ButtonConfirmationOptions): string {
  return buttonConfirmationMarkup(options);
}
