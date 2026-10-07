# Super Admin

**Route:** `/admin`  
**Job:** Ops console for platform, packages, businesses, numbers, voices, and call quality.

**Chrome:** Icon rail on `md+`. Bottom tabs below `md`. Same account header as the owner desk: initials open Appearance (This device) and Sign out. The link list is `ADMIN_LINKS` (Overview, Platform, Packages, Businesses, Quality, Numbers, Voices). It is not the owner desk list. The phone bar shows Overview, Businesses, Quality, Numbers, and More. More holds Platform, Packages, and Voices. The bar does not scroll sideways. A nested admin screen (a business quality record, a traced call) hides the phone tabs and shows one control named for the parent admin list. Hits are at least 44px. Focus ring is the brand ribbon. Filled primary is accent fill with an on-fill label.

Sign-in is `/admin/login` (username and access code). It uses the owner sign-in field density and stays off `/login`. Overview is Needs you plus glance rows. No KPI tiles. No telecom table.

Quality (`/admin/quality`) opens with the title Quality and the line "Traced calls, worst first." The table is worst first: score, trend, top failure, Dropping with the reason in text, calls traced, last call. A phone row says "1 call" when the count is one, and Steady in muted text when the business is not dropping. Search by business name. 7 days and 30 days are underline tabs. Release before/after sits under the table. A business record lists calls, repeat failures, and Couldn't answer. A call shows a breadcrumb back to Quality and to that business, then the score, failing checks, one diagnosis line, and a turn timeline. Save as test downloads a fixture. It does not write the repo. Reads use the service-role client on `public.voice_turn_traces` and the call recording. A turn score and per-turn checks show on that turn only when the row stores them. Older calls keep failing checks on the call. Detected language uses the persisted field when it is there. Tool and filler rows say "Not logged" until those stages are stored. A call with no recording, or a recording that returns 403 or 404, says "No recording for this call". Owner sessions never reach these routes.

Do not send an admin session into owner routes, or an owner session into admin routes.
