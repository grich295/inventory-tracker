Inventory v8.7.14

Admin Bin Setup → Rename preserves location ID, stock/default assignments and transaction references. Existing names at the same location are rejected. Remove now requests and verifies the saved row, avoiding silent zero-row success. Legacy controlled notes plus markers are stripped correctly. Stock/default bins stay active outside the controlled dropdown; empty unused bins become inactive. No history is deleted. Local regressions pass; live button acceptance pending.
