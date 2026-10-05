/**
 * In-app navigation target for the settings discard sheet.
 * Same page, hash-only, and other origins stay on the normal click.
 * @param {string | null | undefined} raw
 * @param {string} current
 * @returns {string | null}
 */
function settingsLeaveHref(raw, current) {
  if (!raw || raw.startsWith("#")) return null;
  let url;
  let here;
  try {
    url = new URL(raw, current);
    here = new URL(current);
  } catch {
    return null;
  }
  if (url.origin !== here.origin) return null;
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return url.pathname + url.search;
}

/**
 * @param {{ dirty: boolean, href: string | null, modified: boolean }} input
 * @returns {string | null}
 */
function settingsLeaveTarget({ dirty, href, modified }) {
  if (!dirty || modified || !href) return null;
  return href;
}

module.exports = { settingsLeaveHref, settingsLeaveTarget };
