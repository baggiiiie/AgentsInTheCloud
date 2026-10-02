import { syntaxSlot, transcriptSlot } from "@agents-in-the-cloud/cli-agent/server";

export const piThemeName = "agents-in-the-cloud";

const { accent, bright, danger, decorative, muted, success, surface, text, warning } = transcriptSlot;

/** Pi's theme: every color is a palette slot, so it follows the viewer's theme. */
export function piAgentsInTheCloudTheme() {
  return {
    name: piThemeName,
    colors: {
      accent, border: muted, borderAccent: accent, borderMuted: muted,
      success, error: danger, warning, muted, dim: muted, text, thinkingText: muted,
      selectedBg: surface, userMessageBg: surface, userMessageText: text,
      customMessageBg: surface, customMessageText: text, customMessageLabel: decorative,
      toolPendingBg: surface, toolSuccessBg: surface, toolErrorBg: surface, toolTitle: text, toolOutput: muted,
      mdHeading: bright, mdLink: accent, mdLinkUrl: muted, mdCode: accent, mdCodeBlock: text, mdCodeBlockBorder: muted,
      mdQuote: muted, mdQuoteBorder: muted, mdHr: muted, mdListBullet: text,
      toolDiffAdded: success, toolDiffRemoved: danger, toolDiffContext: muted,
      syntaxComment: syntaxSlot.comment, syntaxKeyword: syntaxSlot.keyword, syntaxFunction: syntaxSlot.function,
      syntaxVariable: syntaxSlot.variable, syntaxString: syntaxSlot.string, syntaxNumber: syntaxSlot.number,
      syntaxType: syntaxSlot.type, syntaxOperator: text, syntaxPunctuation: text,
      thinkingOff: muted, thinkingMinimal: muted, thinkingLow: accent, thinkingMedium: accent,
      thinkingHigh: decorative, thinkingXhigh: decorative, thinkingMax: decorative,
      bashMode: success,
    },
  };
}
