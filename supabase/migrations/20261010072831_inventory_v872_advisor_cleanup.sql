-- Inventory Tracker v8.7.2
-- Applied live: 2026-10-10
-- Supabase advisor cleanup for Inventory-specific tables.

create index if not exists inventory_client_alerts_v872_site_idx
  on public.inventory_client_alerts(site_id);

create index if not exists inventory_push_subscriptions_v872_site_idx
  on public.inventory_push_subscriptions(site_id);

create index if not exists safety_bridge_final_warning_v872_item_idx
  on public.safety_bridge_final_warning_uses_v852(item_id);

create index if not exists safety_bridge_item_links_v872_linked_by_idx
  on public.safety_bridge_item_links(linked_by)
  where linked_by is not null;

create index if not exists safety_bridge_feedback_v872_decided_by_idx
  on public.safety_bridge_link_feedback(decided_by)
  where decided_by is not null;

create index if not exists safety_bridge_settings_v872_updated_by_idx
  on public.safety_bridge_settings(updated_by)
  where updated_by is not null;

-- Split manage/admin ALL policies so they do not duplicate the SELECT policy.
drop policy if exists stock_locations_manage_v872 on public.stock_locations;
create policy stock_locations_insert_v872 on public.stock_locations
  for insert to authenticated
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  );
create policy stock_locations_update_v872 on public.stock_locations
  for update to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  )
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  );
create policy stock_locations_delete_v872 on public.stock_locations
  for delete to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  );

drop policy if exists item_suppliers_manage_v872 on public.item_suppliers;
create policy item_suppliers_insert_v872 on public.item_suppliers
  for insert to authenticated
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  );
create policy item_suppliers_update_v872 on public.item_suppliers
  for update to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  )
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  );
create policy item_suppliers_delete_v872 on public.item_suppliers
  for delete to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  );

drop policy if exists inventory_categories_admin_v872 on public.inventory_categories;
create policy inventory_categories_insert_v872 on public.inventory_categories
  for insert to authenticated
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_admin()
  );
create policy inventory_categories_update_v872 on public.inventory_categories
  for update to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_admin()
  )
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_admin()
  );
create policy inventory_categories_delete_v872 on public.inventory_categories
  for delete to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_admin()
  );

drop policy if exists stocktake_settings_admin_v872 on public.stocktake_settings;
create policy stocktake_settings_insert_v872 on public.stocktake_settings
  for insert to authenticated
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_admin()
  );
create policy stocktake_settings_update_v872 on public.stocktake_settings
  for update to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_admin()
  )
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_admin()
  );
create policy stocktake_settings_delete_v872 on public.stocktake_settings
  for delete to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_admin()
  );

-- These tables are service/RPC-only. Explicit deny policies document that intent.
drop policy if exists inventory_client_alerts_service_only_v872 on public.inventory_client_alerts;
create policy inventory_client_alerts_service_only_v872
  on public.inventory_client_alerts
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists inventory_push_event_state_service_only_v872 on public.inventory_push_event_state;
create policy inventory_push_event_state_service_only_v872
  on public.inventory_push_event_state
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists inventory_push_runtime_service_only_v872 on public.inventory_push_runtime_config;
create policy inventory_push_runtime_service_only_v872
  on public.inventory_push_runtime_config
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists safety_bridge_events_service_only_v872 on public.safety_bridge_events;
create policy safety_bridge_events_service_only_v872
  on public.safety_bridge_events
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists safety_bridge_final_warning_service_only_v872 on public.safety_bridge_final_warning_uses_v852;
create policy safety_bridge_final_warning_service_only_v872
  on public.safety_bridge_final_warning_uses_v852
  for all to authenticated
  using (false)
  with check (false);
