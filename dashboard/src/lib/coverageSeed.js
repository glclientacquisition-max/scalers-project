/* eslint-disable @typescript-eslint/no-require-imports */
// Turn old Delivery or Coverage sentences into directory ids.
// A written county stays a county. A written estate stays that estate.
// "Mombasa Road" does not select Mombasa county.

const INDEX = require("./data/kenyaPlaceCounties.json");

const COUNTY_SET = new Set(INDEX.counties);
const MAX_AREAS = 40;

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function areasFromPlainText(text) {
  const phrase = normalizeText(text);
  if (!phrase) return [];
  const words = phrase.split(" ");
  const used = new Array(words.length).fill(false);
  const counties = [];
  const places = [];

  for (let i = 0; i < words.length - 1; i += 1) {
    if (used[i]) continue;
    const pair = `${words[i]} ${words[i + 1]}`;
    if (COUNTY_SET.has(pair)) {
      counties.push(`county:${pair}`);
      used[i] = true;
      used[i + 1] = true;
      continue;
    }
    if (INDEX.places[pair] && !COUNTY_SET.has(pair)) {
      places.push(`place:${pair}`);
      used[i] = true;
      used[i + 1] = true;
    }
  }

  for (let i = 0; i < words.length; i += 1) {
    if (used[i] || words[i].length < 4) continue;
    if (COUNTY_SET.has(words[i])) {
      counties.push(`county:${words[i]}`);
      used[i] = true;
      continue;
    }
    if (INDEX.places[words[i]]) {
      places.push(`place:${words[i]}`);
      used[i] = true;
    }
  }

  const countyNames = new Set(counties.map((id) => id.slice("county:".length)));
  const keptPlaces = places.filter((id) => {
    const name = id.slice("place:".length);
    const list = INDEX.places[name] || [];
    return !list.some((county) => countyNames.has(county));
  });

  const seen = new Set();
  const out = [];
  for (const id of [...counties, ...keptPlaces]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_AREAS) break;
  }
  return out;
}

module.exports = { areasFromPlainText };
