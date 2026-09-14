Inventory Tracker v8.5.4

Change in this build:
- Add Stock and Use / Remove Stock keep the existing quantity box.
- Two large quick buttons are added beside the quantity box:
  ▼ decreases by 1
  ▲ increases by 1
- Manual typing still works exactly as before.
- Existing decimal quantities are still supported.
- Use Stock still respects the maximum stock available at the selected location.
- Quick decrement will not take the value below the valid minimum.
- Move Stock and Adjust Stock are unchanged.
- No Supabase/database migration is required.

This update is based on the existing Inventory Tracker v8.5.3 app.

INSTALL
1. Keep the existing app.js, config.js, styles.css and other app files.
2. Upload app-v854.js to the repository root.
3. Replace index.html with the supplied index.html.
4. Commit/deploy.
5. Hard refresh or reopen the installed PWA if an older cached version appears.

Important:
app-v854.js deliberately loads the existing app.js v8.5.3 baseline and applies only
the quantity-stepper enhancement. This avoids changing working inventory logic.
