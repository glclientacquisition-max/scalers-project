# Super Admin

**Route:** `/admin`  
**Job:** Ops console for platform, packages, businesses, numbers, and voices.

**Chrome:** Icon rail on `md+`. Bottom tabs below `md`. Same account header as the owner desk: initials open Appearance (This device) and Sign out. The link list is `ADMIN_LINKS`: Today, Businesses, Calls, Billing, Numbers, Platform, Activity, Settings. Calls opens the calls section on Today until the Calls screen exists. Activity shows as not built yet and links nowhere. Settings opens Voices. Packages and the old Ledger sit under Billing. It is not the owner desk list. A nested admin screen hides the phone tabs and shows one control named for the parent admin list. Hits are at least 44px. Focus ring is the brand ribbon. Filled primary is accent fill with an on-fill label.

Sign-in is `/admin/login` (username and access code). It uses the owner sign-in field density and stays off `/login`. Today (`/admin`) is a status line, one Needs you queue, and today's calls against the same stretch last week. Plain rows, no KPI tiles, no telecom table. It reads only: the notice check and alert mail run when Platform loads.

Phone: Today, Businesses, Calls, Billing, and More. More is a bottom Sheet with Numbers, Platform, Activity, and Settings. Billing client pages and Packages are nested under Billing, so they hide the tabs and show the Billing control.

Do not send an admin session into owner routes, or an owner session into admin routes.
