/**
 * Kenya county land borders, keyed by Service areas tree ids (county:<slug>).
 * Used only to pick which counties the Service areas picker shows first.
 *
 * Checked 27 Oct 2026 against geoBoundaries KEN ADM1 (gbOpen, RCMRD 2020) polygons,
 * each county's Wikipedia page and county CIDPs. Rule: a pair is in when the
 * polygons share a border, or touch at a point and an official county document
 * or both Wikipedia pages name the pair (the Mt Kenya summit counties, Kirinyaga
 * and Machakos, Narok and Nyamira, Embu and Murang'a). Pairs whose polygons don't
 * touch are out whatever a page says. Lake Victoria water crossings are not
 * borders (Siaya and Homa Bay).
 * Pure and browser-safe. Relative imports only so node tests can load it.
 */

const BORDERS: ReadonlyArray<readonly [string, string]> = [
  ["mombasa", "kilifi"], ["mombasa", "kwale"],
  ["kwale", "kilifi"], ["kwale", "taita-taveta"],
  ["kilifi", "taita-taveta"], ["kilifi", "tana-river"],
  ["tana-river", "lamu"], ["tana-river", "garissa"], ["tana-river", "kitui"], ["tana-river", "isiolo"], ["tana-river", "taita-taveta"],
  ["lamu", "garissa"],
  ["taita-taveta", "kitui"], ["taita-taveta", "makueni"], ["taita-taveta", "kajiado"],
  ["garissa", "wajir"], ["garissa", "isiolo"],
  ["wajir", "mandera"], ["wajir", "marsabit"], ["wajir", "isiolo"],
  ["marsabit", "isiolo"], ["marsabit", "samburu"], ["marsabit", "turkana"],
  ["isiolo", "meru"], ["isiolo", "laikipia"], ["isiolo", "samburu"], ["isiolo", "kitui"],
  ["meru", "laikipia"], ["meru", "nyeri"], ["meru", "tharaka-nithi"], ["meru", "kitui"],
  ["tharaka-nithi", "embu"], ["tharaka-nithi", "kitui"], ["tharaka-nithi", "kirinyaga"], ["tharaka-nithi", "nyeri"],
  ["embu", "kitui"], ["embu", "machakos"], ["embu", "muranga"], ["embu", "kirinyaga"],
  ["kitui", "machakos"], ["kitui", "makueni"],
  ["machakos", "nairobi"], ["machakos", "kiambu"], ["machakos", "muranga"], ["machakos", "makueni"], ["machakos", "kajiado"],
  ["makueni", "kajiado"],
  ["nyandarua", "nyeri"], ["nyandarua", "muranga"], ["nyandarua", "kiambu"], ["nyandarua", "nakuru"], ["nyandarua", "laikipia"],
  ["nyeri", "laikipia"], ["nyeri", "kirinyaga"], ["nyeri", "muranga"],
  ["kirinyaga", "muranga"], ["kirinyaga", "machakos"],
  ["muranga", "kiambu"],
  ["kiambu", "nairobi"], ["kiambu", "kajiado"], ["kiambu", "nakuru"],
  ["turkana", "west-pokot"], ["turkana", "baringo"], ["turkana", "samburu"],
  ["west-pokot", "baringo"], ["west-pokot", "elgeyo-marakwet"], ["west-pokot", "trans-nzoia"],
  ["samburu", "laikipia"], ["samburu", "baringo"],
  ["trans-nzoia", "elgeyo-marakwet"], ["trans-nzoia", "uasin-gishu"], ["trans-nzoia", "kakamega"], ["trans-nzoia", "bungoma"],
  ["uasin-gishu", "elgeyo-marakwet"], ["uasin-gishu", "baringo"], ["uasin-gishu", "nandi"], ["uasin-gishu", "kakamega"], ["uasin-gishu", "kericho"],
  ["elgeyo-marakwet", "baringo"],
  ["nandi", "kakamega"], ["nandi", "vihiga"], ["nandi", "kisumu"], ["nandi", "kericho"],
  ["baringo", "laikipia"], ["baringo", "nakuru"], ["baringo", "kericho"],
  ["laikipia", "nakuru"],
  ["nakuru", "kajiado"], ["nakuru", "narok"], ["nakuru", "bomet"], ["nakuru", "kericho"],
  ["narok", "kajiado"], ["narok", "bomet"], ["narok", "kisii"], ["narok", "migori"], ["narok", "nyamira"],
  ["kajiado", "nairobi"],
  ["kericho", "kisumu"], ["kericho", "bomet"], ["kericho", "nyamira"], ["kericho", "homa-bay"],
  ["bomet", "nyamira"],
  ["kakamega", "bungoma"], ["kakamega", "vihiga"], ["kakamega", "siaya"], ["kakamega", "busia"],
  ["vihiga", "kisumu"], ["vihiga", "siaya"],
  ["bungoma", "busia"],
  ["busia", "siaya"],
  ["siaya", "kisumu"],
  ["kisumu", "homa-bay"],
  ["homa-bay", "kisii"], ["homa-bay", "migori"], ["homa-bay", "nyamira"],
  ["migori", "kisii"],
  ["kisii", "nyamira"],
];

const NEIGHBOURS: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const s = m.get(a) ?? new Set<string>();
    s.add(b);
    m.set(a, s);
  };
  for (const [a, b] of BORDERS) {
    add(`county:${a}`, `county:${b}`);
    add(`county:${b}`, `county:${a}`);
  }
  return new Map([...m].map(([k, v]) => [k, [...v].sort()]));
})();

/** Counties that share a land border with this one. Unknown id gives []. */
export function countyNeighbours(countyId: string): readonly string[] {
  return NEIGHBOURS.get(countyId) ?? [];
}

/** Every county id the map knows. */
export function adjacencyCountyIds(): string[] {
  return [...NEIGHBOURS.keys()].sort();
}

/** The business's county first, then its neighbours. Empty when unknown. */
export function nearbyCounties(countyId: string | null | undefined): string[] {
  if (!countyId || !NEIGHBOURS.has(countyId)) return [];
  return [countyId, ...countyNeighbours(countyId)];
}
