/** Pills mark exceptions. Live and Active are the usual state, so they stay quiet. */
export function isDefaultStatus(label: string): boolean {
  const word = label.trim().toLowerCase();
  return word === "live" || word === "active";
}
