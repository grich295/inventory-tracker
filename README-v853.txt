Inventory Tracker v8.5.3

- Rebuilt Demo mode into an interactive version of the app rather than a single information page.
- Demo opens in the simplified User view with Home, Scan, Items and Help.
- Home stocktake card is interactive: amber due -> complete sample stocktake -> green none assigned.
- Demo Admin switch exposes sample Dashboard, Locations, Orders, Reports, History, Stocktake Admin, Users, Bin Setup, Safety Bridge, Legacy and Backup pages.
- Demo Scan simulates QR scanning and opens sample items.
- Demo Items supports search and item detail/actions. Add/Use/Move/Adjust update temporary demo data only.
- Demo Stocktake Admin can show due, overdue (red) and complete states.
- Demo reports include a safe sample CSV export.
- Safety Tracker link is shown in Demo mode only when the live Inventory Safety Bridge setting is enabled.
- Live Inventory data is never changed by Demo mode.
- Existing v8.5.0 User navigation, stocktake Home status, password guidance, offline mode and Safety Bridge behaviour are retained.

Keep your existing config.js. Replace index.html, app.js, styles.css and sw.js.


v8.5.2 Safety Bridge behaviour:
- Amber warning starts 7 days before required training due date.
- On due date or overdue, user gets one final warned Use Stock action.
- After that Use is successfully recorded, further Use Stock is blocked until Safety Tracker training is completed.
- Missing Safety profile/assignment/session remains an immediate block.
- Add, Move and Adjust are unaffected.


v8.5.3
- Restores delivery receiving for normal Users without bringing back the Orders tab.
- Home now shows a Deliveries status card with a Receive delivery action when open orders exist.
- Open item details also show Receive delivery beside any outstanding order.
- Admin/Manager Orders page remains unchanged.
