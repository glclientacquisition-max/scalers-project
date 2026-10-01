import { SETTINGS_HOURS_HREF } from "@/lib/businessSettingsNav";

/** Viewport hint for the settings index. Not a session. */
export const DESK_MD_COOKIE = "desk-md";

/** Same cutoff as Tailwind `md`. */
export const DESK_MD_MEDIA = "(min-width: 768px)";

/**
 * Runs before paint. Records whether the viewport is md+ and, on a wide
 * bare /settings load, replaces to Hours so the index does not mount the form.
 * A later request reads the cookie and redirects on the server.
 */
export const DESK_MD_BOOT_SCRIPT = `(function(){try{var m=window.matchMedia(${JSON.stringify(DESK_MD_MEDIA)});function write(on){document.cookie=${JSON.stringify(DESK_MD_COOKIE)}+"="+(on?"1":"0")+"; Path=/; Max-Age=31536000; SameSite=Lax";}function go(){var on=m.matches;write(on);if(!on)return;var path=window.location.pathname;if(path!=="/settings"&&path!=="/settings/")return;if(window.location.search)return;window.location.replace(${JSON.stringify(SETTINGS_HOURS_HREF)});}go();m.addEventListener("change",go);}catch(e){}})();`;
