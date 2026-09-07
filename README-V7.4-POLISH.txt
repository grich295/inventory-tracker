Inventory Tracker v7.4 - Inventory Polish

Keeps the v7.3 no-H&S build and v7.1 camera improvements.

Changes:
1. New invited users are forced to set their own password before entering the tracker.
2. Stock quantities accept decimal values in 0.01 steps across Add, Use, Move, Adjust, Stocktake, Orders, Receiving, Reorder Level, Opening Stock and Supplier Pack Size.

INSTALLATION
A. GitHub Pages
Replace these four files in the repository root:
- index.html
- app.js
- styles.css
- sw.js

B. Supabase Edge Function (required for the first-login password fix)
Redeploy the existing Edge Function named exactly: invite-user
Replace its index.ts with:
- supabase/functions/invite-user/index.ts
Then deploy it.

No Supabase SQL migration is required for v7.4. Existing numeric database columns already support decimal quantities.

After GitHub deploy, open the tracker with ?v=74 and confirm the header says v7.4.

Existing users are not forced through the new first-login screen. The flag is applied to NEW invitations sent after the v7.4 invite-user function is deployed.
