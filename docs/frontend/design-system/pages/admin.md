# Super Admin

**Route:** `/admin`  
**Job:** Ops console for platform, packages, businesses, numbers, and voices.

**Chrome:** Icon rail on `md+`. Bottom tabs below `md`. Same account header as the owner desk: initials open Appearance (This device) and Sign out. The link list is `ADMIN_LINKS` (Overview, Platform, Packages, Businesses, Numbers, Voices). It is not the owner desk list. A nested admin screen hides the phone tabs and shows one control named for the parent admin list. Hits are at least 44px. Focus ring is the brand ribbon. Filled primary is accent fill with an on-fill label.

Sign-in is `/admin/login` (username and access code). It uses the owner sign-in field density and stays off `/login`. Overview is Needs you plus glance rows. No KPI tiles. No telecom table.

The six phone tabs share the thumb row. There is no More item. No admin screen is nested under a list yet, so the parent-list control does not render on current routes.

Do not send an admin session into owner routes, or an owner session into admin routes.
