// Pure formatter for the TopNav bell's unread-count chip (P2-2, spec §3: "unread-count
// chip (cap display at '9+')... always show the bell, chip only when >0"). Returns null
// when the chip should not render at all (zero or a defensive negative), the exact digit
// for 1-9, or the literal "9+" once it clips — never a raw large number that would blow
// out the compact 32px bell button.
export function formatUnreadBadge(count: number): string | null {
  if (count <= 0) return null
  if (count > 9) return '9+'
  return String(count)
}
