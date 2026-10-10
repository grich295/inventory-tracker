# Inventory Tracker

Current production build: **v8.7.2 CLEAN**

## Active runtime

- index.html
- styles.css
- config.js
- app-loader.js
- app.js
- safe-boot.js
- master-login.js
- sw.js
- manifest.webmanifest
- icon.svg
- version.json

## Current design

- Supabase provides shared inventory data and authentication.
- GitHub Pages serves the PWA.
- Day-to-day screens load the latest 420 days of transactions.
- Reports, History and Legacy Review load the complete transaction history only when opened.
- Offline stock mode keeps recent stock data on the device and can queue Add, Use, Move and Adjust actions.
- QR scanning uses the phone camera with multiple decoding fallbacks.
- Stocktake completion is atomic on the server. If live stock changes while a count is in progress, the task refreshes instead of overwriting that movement.
- Admin backup still exports the full database tables.

## Database migration

Database migrations under `supabase/migrations/` are already applied to the live project. v8.7.2 adds site-safe RLS, SECURITY DEFINER hardening, Inventory indexes, an hourly integrity watchdog, and Web Push infrastructure.

The deployed alert function source is stored at:

`supabase/functions/inventory-alerts/index.ts`

Phone alerts are opt-in per device from Help. The server checks hourly and can notify while the PWA is closed for low stock, overdue orders, overdue stocktakes, watchdog issues and sync failures.

## Source layout

The current invite/admin user-management function source is stored at:

supabase/functions/invite-user/index.ts

Old versioned loaders, disabled frontend decorators and unrelated historical files were removed from the current branch during the cleanup. Git history remains the archive.

## PWA cache rule

Inventory cache names begin with inventory-tracker-. The Inventory service worker must only remove Inventory caches so it cannot clear caches belonging to the other tracker apps.
