INVENTORY TRACKER v8.7.0 CLEAN - CURRENT RUNTIME

Active browser files:
- index.html
- styles.css
- config.js
- app-v859.js
- app.js
- hotfix-v863-safe-boot.js
- hotfix-v865-master-login.js
- sw.js
- manifest.webmanifest
- version.json

v8.7.0 audit/performance changes:
- Defers realtime full-data refresh while QR scanning or stock-action modals are active.
- Debounces the paint/variant DOM observer and ignores scanner-only DOM changes.
- Deduplicates concurrent paint/variant item queries.
- Aligns the visible version and backup manifest.
- Loads page scripts with defer so downloads can run in parallel.
- Service-worker cleanup is now Inventory-only and cannot delete Safety/Energy caches.
- Offline fallback now handles the ?v= build query strings used by index.html.
- Current login hotfix and runtime CDN libraries are included in the PWA cache.

Important:
- hotfix-v860-people-access.js, hotfix-v861-multisite-clean-backup.js and
  hotfix-v862-multisite-freeze-fix.js are NOT loaded by index.html.
  Their database changes may still exist, but the older frontend decorators remain disabled.
- Older app-v*.js, bulk-import*.js, hotfix-v21029-exception.js and sw-v21028.js
  are historical/unreferenced files and are not part of the current runtime.
