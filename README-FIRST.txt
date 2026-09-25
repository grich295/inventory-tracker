INVENTORY v8.6.3 SAFE BOOT

Upload all four files to the Inventory repository root:
- index.html
- sw.js
- hotfix-v863-safe-boot.js
- version.json

Do not delete app.js or app-v859.js.

This recovery build deliberately stops loading:
- hotfix-v860-people-access.js
- hotfix-v862-multisite-freeze-fix.js

Those files can remain in GitHub; index.html simply does not load them.

The Supabase database multi-site/access work is NOT rolled back and Main Hotel
data remains intact. No SQL/Supabase update is required.

The service worker cache is also bumped and no longer returns index.html when a
JavaScript file fails to download.
