# Inventory Tracker

Current production build: **v8.7.4 CLEAN**

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

Database migrations under `supabase/migrations/` are already applied to the live project. v8.7.4 adds site-safe RLS, SECURITY DEFINER hardening, Inventory indexes, an hourly integrity watchdog, and Web Push infrastructure.

The deployed alert function source is stored at:

`supabase/functions/inventory-alerts/index.ts`

Phone alerts are opt-in per device from Help. The server checks hourly and can notify while the PWA is closed for low stock, overdue orders, overdue stocktakes, watchdog issues and sync failures.

## Source layout

The current invite/admin user-management function source is stored at:

supabase/functions/invite-user/index.ts

Old versioned loaders, disabled frontend decorators and unrelated historical files were removed from the current branch during the cleanup. Git history remains the archive.

## PWA cache rule

Inventory cache names begin with inventory-tracker-. The Inventory service worker must only remove Inventory caches so it cannot clear caches belonging to the other tracker apps.

## v8.7.4 access hardening

Inventory demo mode and its RPC are removed. The seven anonymously callable privileged functions were reviewed: anonymous grants were revoked, the trigger helper cannot be called by app roles, and legacy Energy imports require the selected authorised site. citext is in the extensions schema; case-insensitive username comparison was verified.

## v8.7.4 role and policy review

Reviewed all 43 signed-in SECURITY DEFINER functions. Two trigger functions no longer allow direct authenticated calls. Active profile and app membership are required for site resolution; disabled modules cannot use site-only fallback. Inventory admin/manager helpers use the selected-site role override then module role. Privileged Inventory operations check active accounts and app/site access; stock operations reject viewers. Risk assessments are restricted to Inventory admins and selected-site items.

Consolidated policies on 11 tables, retaining separate read and write permissions and combining site checks with role checks. Added 40 FK indexes reported by Supabase; retained existing unused indexes pending workload evidence.

Validation: database-role tests for Admin, Manager, User and simulated Viewer; unconfigured and disabled-module accounts denied; User admin action denied; invalid item denied; authorised User stock ADD verified in a transaction and rolled back. Advisor reports now retain only intentional authenticated-definer notices, unused indexes and disabled leaked-password protection. No enabled push subscriptions are registered, so phone delivery is unverified.
