export function unpricedLabelText(n: number): string {
  return `${n} item${n === 1 ? " has" : "s have"} no price`;
}
