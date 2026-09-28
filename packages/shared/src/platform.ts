/// <reference lib="dom" />

/** Apple platforms use ⌘ where other platforms use Ctrl for application shortcuts. */
export function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}
