/**
 * Pure keyboard-navigation math for a horizontal WAI-ARIA tablist (§20).
 *
 * Given the pressed key, the current tab index and the tab count, returns the
 * index to move focus/selection to, or null when the key isn't a tablist key.
 * Kept framework-free so it can be unit-tested without a DOM.
 */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count
    case 'ArrowLeft':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
