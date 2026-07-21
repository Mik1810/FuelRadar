export function nextComboboxIndex(
  current: number,
  count: number,
  direction: "next" | "previous",
): number {
  if (count <= 0) return -1;
  if (current < 0) return direction === "next" ? 0 : count - 1;
  return direction === "next"
    ? Math.min(count - 1, current + 1)
    : Math.max(0, current - 1);
}
