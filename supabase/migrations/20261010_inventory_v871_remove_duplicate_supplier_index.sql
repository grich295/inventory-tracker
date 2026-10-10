-- Inventory Tracker v8.7.1
-- Remove duplicate unique index; item_suppliers_item_slot_uq remains in place.
drop index if exists public.item_suppliers_item_slot_unique;
