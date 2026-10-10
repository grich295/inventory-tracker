-- Inventory Tracker v8.7.2
-- Applied live: 2026-10-10
-- Security/RLS/index hardening.
--
-- This migration records the production hardening applied in Supabase:
--   * active-profile checks for Inventory role helpers and stock mutation
--   * forced stocktake creation restricted to Inventory admins
--   * Safety Bridge RPCs constrained to the selected Inventory site
--   * anonymous EXECUTE removed from internal site/stocktake helpers
--   * permissive site-scope RLS replaced with explicit operation policies
--   * auth.uid() calls wrapped in SELECT for RLS init-plan performance
--   * Inventory foreign-key/access indexes added
--
-- The full current function bodies can be regenerated from pg_get_functiondef()
-- in the live project. The statements below are the RLS/grant/index portion of
-- the applied migration and are safe to replay after the earlier Inventory schema
-- migrations have been applied.

revoke execute on function public.current_app_site_v21138(text) from public, anon;
revoke execute on function public.set_current_app_site_v21138(text,uuid) from public, anon;
revoke execute on function public.inventory_site_for_caller_v21138() from public, anon;
revoke execute on function public.refresh_stocktake_task_positions_v868(uuid) from public, anon;
grant execute on function public.current_app_site_v21138(text) to authenticated, service_role;
grant execute on function public.set_current_app_site_v21138(text,uuid) to authenticated, service_role;
grant execute on function public.inventory_site_for_caller_v21138() to authenticated, service_role;
grant execute on function public.refresh_stocktake_task_positions_v868(uuid) to authenticated, service_role;

revoke execute on function public.get_inventory_demo_config_v850() from public;
grant execute on function public.get_inventory_demo_config_v850() to anon, authenticated, service_role;

-- ITEMS
drop policy if exists inventory_site_scope_v21138 on public.items;
drop policy if exists items_read on public.items;
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
create policy items_read_v872 on public.items
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));
create policy items_insert_v872 on public.items
  for insert to authenticated
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  );
create policy items_update_v872 on public.items
  for update to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  )
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  );

-- LOCATIONS
drop policy if exists inventory_site_scope_v21138 on public.stock_locations;
drop policy if exists loc_read on public.stock_locations;
drop policy if exists loc_write on public.stock_locations;
create policy stock_locations_read_v872 on public.stock_locations
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));

-- BALANCES
drop policy if exists inventory_site_scope_v21138 on public.stock_balances;
drop policy if exists bal_read on public.stock_balances;
create policy stock_balances_read_v872 on public.stock_balances
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));

-- TRANSACTIONS
drop policy if exists inventory_site_scope_v21138 on public.transactions;
drop policy if exists tx_read on public.transactions;
create policy transactions_read_v872 on public.transactions
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));

-- CATEGORIES
drop policy if exists inventory_site_scope_v21138 on public.inventory_categories;
drop policy if exists inventory_categories_admin on public.inventory_categories;
drop policy if exists inventory_categories_read on public.inventory_categories;
create policy inventory_categories_read_v872 on public.inventory_categories
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));

-- SETTINGS
drop policy if exists inventory_site_scope_v21138 on public.inventory_settings;
drop policy if exists inventory_settings_admin_update on public.inventory_settings;
drop policy if exists inventory_settings_read on public.inventory_settings;
create policy inventory_settings_read_v872 on public.inventory_settings
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));
create policy inventory_settings_admin_update_v872 on public.inventory_settings
  for update to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_inventory_admin_v836()
  )
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_inventory_admin_v836()
  );

-- SUPPLIERS
drop policy if exists inventory_site_scope_v21138 on public.item_suppliers;
drop policy if exists item_suppliers_manage on public.item_suppliers;
drop policy if exists item_suppliers_read on public.item_suppliers;
create policy item_suppliers_read_v872 on public.item_suppliers
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));

-- PURCHASE ORDERS
drop policy if exists inventory_site_scope_v21138 on public.purchase_orders;
drop policy if exists purchase_orders_insert on public.purchase_orders;
drop policy if exists purchase_orders_read on public.purchase_orders;
drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_read_v872 on public.purchase_orders
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));
create policy purchase_orders_insert_v872 on public.purchase_orders
  for insert to authenticated
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  );
create policy purchase_orders_update_v872 on public.purchase_orders
  for update to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  )
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and public.is_manager_or_admin()
  );

-- USER PREFERENCES
drop policy if exists inventory_site_scope_v21138 on public.user_item_preferences;
drop policy if exists user_item_preferences_read on public.user_item_preferences;
drop policy if exists user_item_preferences_insert on public.user_item_preferences;
drop policy if exists user_item_preferences_update on public.user_item_preferences;
drop policy if exists user_item_preferences_delete on public.user_item_preferences;
create policy user_item_preferences_read_v872 on public.user_item_preferences
  for select to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and (user_id=(select auth.uid()) or public.is_admin())
  );
create policy user_item_preferences_insert_v872 on public.user_item_preferences
  for insert to authenticated
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and user_id=(select auth.uid())
  );
create policy user_item_preferences_update_v872 on public.user_item_preferences
  for update to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and user_id=(select auth.uid())
  )
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and user_id=(select auth.uid())
  );
create policy user_item_preferences_delete_v872 on public.user_item_preferences
  for delete to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and user_id=(select auth.uid())
  );

-- STOCKTAKE SETTINGS
drop policy if exists inventory_site_scope_v21138 on public.stocktake_settings;
drop policy if exists stocktake_settings_admin on public.stocktake_settings;
drop policy if exists stocktake_settings_read on public.stocktake_settings;
create policy stocktake_settings_read_v872 on public.stocktake_settings
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));

-- STOCKTAKE TASKS
drop policy if exists inventory_site_scope_v21138 on public.stocktake_tasks;
drop policy if exists stocktake_tasks_read on public.stocktake_tasks;
drop policy if exists stocktake_tasks_update on public.stocktake_tasks;
create policy stocktake_tasks_read_v872 on public.stocktake_tasks
  for select to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and (assigned_user_id=(select auth.uid()) or public.is_admin())
  );
create policy stocktake_tasks_update_v872 on public.stocktake_tasks
  for update to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and (assigned_user_id=(select auth.uid()) or public.is_admin())
  )
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and (assigned_user_id=(select auth.uid()) or public.is_admin())
  );

-- STOCKTAKE LINES
drop policy if exists inventory_site_scope_v21138 on public.stocktake_task_items;
drop policy if exists stocktake_task_items_read on public.stocktake_task_items;
drop policy if exists stocktake_task_items_update on public.stocktake_task_items;
create policy stocktake_task_items_read_v872 on public.stocktake_task_items
  for select to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and exists(
      select 1 from public.stocktake_tasks t
      where t.id=stocktake_task_items.task_id
        and t.site_id=stocktake_task_items.site_id
        and (t.assigned_user_id=(select auth.uid()) or public.is_admin())
    )
  );
create policy stocktake_task_items_update_v872 on public.stocktake_task_items
  for update to authenticated
  using (
    site_id=public.current_app_site_v21138('inventory')
    and exists(
      select 1 from public.stocktake_tasks t
      where t.id=stocktake_task_items.task_id
        and t.site_id=stocktake_task_items.site_id
        and (t.assigned_user_id=(select auth.uid()) or public.is_admin())
    )
  )
  with check (
    site_id=public.current_app_site_v21138('inventory')
    and exists(
      select 1 from public.stocktake_tasks t
      where t.id=stocktake_task_items.task_id
        and t.site_id=stocktake_task_items.site_id
        and (t.assigned_user_id=(select auth.uid()) or public.is_admin())
    )
  );

-- SAFETY BRIDGE direct reads are site-scoped; mutations are RPC-only.
drop policy if exists inventory_site_scope_v21138 on public.safety_bridge_settings;
drop policy if exists safety_bridge_settings_read on public.safety_bridge_settings;
create policy safety_bridge_settings_read_v872 on public.safety_bridge_settings
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));

drop policy if exists inventory_site_scope_v21138 on public.safety_bridge_item_links;
drop policy if exists safety_bridge_item_links_read on public.safety_bridge_item_links;
create policy safety_bridge_item_links_read_v872 on public.safety_bridge_item_links
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));

drop policy if exists inventory_site_scope_v21138 on public.safety_bridge_link_feedback;
drop policy if exists safety_bridge_feedback_read_v843 on public.safety_bridge_link_feedback;
create policy safety_bridge_link_feedback_read_v872 on public.safety_bridge_link_feedback
  for select to authenticated
  using (site_id=public.current_app_site_v21138('inventory'));

drop policy if exists inventory_site_scope_v21138 on public.safety_bridge_events;
drop policy if exists inventory_site_scope_v21138 on public.safety_bridge_final_warning_uses_v852;

-- Shared site/access policy performance.
drop policy if exists app_current_site_v21138_self_read on public.app_current_site_v21138;
drop policy if exists app_current_site_v21138_self_write on public.app_current_site_v21138;
create policy app_current_site_v872_access on public.app_current_site_v21138
  for all to authenticated
  using (user_id=(select auth.uid()) or public.is_admin())
  with check (user_id=(select auth.uid()) or public.is_admin());

drop policy if exists app_site_access_v21137_admin on public.app_site_access_v21137;
drop policy if exists app_site_access_v21137_read on public.app_site_access_v21137;
create policy app_site_access_v872_read on public.app_site_access_v21137
  for select to authenticated
  using (user_id=(select auth.uid()) or public.is_admin());
create policy app_site_access_v872_admin_insert on public.app_site_access_v21137
  for insert to authenticated with check (public.is_admin());
create policy app_site_access_v872_admin_update on public.app_site_access_v21137
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy app_site_access_v872_admin_delete on public.app_site_access_v21137
  for delete to authenticated using (public.is_admin());

-- Inventory access/foreign-key indexes.
create index if not exists app_current_site_v872_site_idx on public.app_current_site_v21138(site_id);
create index if not exists app_module_access_v872_home_site_idx on public.app_module_access(home_site_id) where home_site_id is not null;
create index if not exists app_module_access_v872_updated_by_idx on public.app_module_access(updated_by) where updated_by is not null;
create index if not exists app_site_access_v872_site_idx on public.app_site_access_v21137(site_id);
create index if not exists items_v872_created_by_idx on public.items(created_by) where created_by is not null;
create index if not exists items_v872_archived_by_idx on public.items(archived_by) where archived_by is not null;
create index if not exists items_v872_risk_assessed_by_idx on public.items(risk_assessed_by) where risk_assessed_by is not null;
create index if not exists stock_balances_v872_location_idx on public.stock_balances(location_id);
create index if not exists transactions_v872_from_location_idx on public.transactions(from_location_id) where from_location_id is not null;
create index if not exists transactions_v872_to_location_idx on public.transactions(to_location_id) where to_location_id is not null;
create index if not exists transactions_v872_legacy_reviewer_idx on public.transactions(legacy_reviewed_by) where legacy_reviewed_by is not null;
create index if not exists purchase_orders_v872_supplier_idx on public.purchase_orders(supplier_id) where supplier_id is not null;
create index if not exists purchase_orders_v872_ordered_by_idx on public.purchase_orders(ordered_by);
create index if not exists purchase_orders_v872_cancelled_by_idx on public.purchase_orders(cancelled_by) where cancelled_by is not null;
create index if not exists inventory_settings_v872_updated_by_idx on public.inventory_settings(updated_by) where updated_by is not null;
create index if not exists profiles_v872_disabled_by_idx on public.profiles(disabled_by) where disabled_by is not null;
create index if not exists stocktake_tasks_v872_assigned_user_idx on public.stocktake_tasks(assigned_user_id);
create index if not exists stocktake_tasks_v872_completed_by_idx on public.stocktake_tasks(completed_by) where completed_by is not null;
create index if not exists stocktake_task_items_v872_item_idx on public.stocktake_task_items(item_id);
create index if not exists stocktake_task_items_v872_location_idx on public.stocktake_task_items(location_id);
create index if not exists stocktake_task_items_v872_adjust_tx_idx on public.stocktake_task_items(adjusted_transaction_id) where adjusted_transaction_id is not null;
create index if not exists user_item_preferences_v872_item_idx on public.user_item_preferences(item_id);
