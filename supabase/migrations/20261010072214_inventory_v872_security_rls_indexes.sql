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
-- Hardened SECURITY DEFINER function bodies captured from the live v8.7.2 schema.

CREATE OR REPLACE FUNCTION public.apply_stock_transaction(p_item_id uuid, p_type transaction_type, p_quantity numeric DEFAULT 0, p_from_location_id uuid DEFAULT NULL::uuid, p_to_location_id uuid DEFAULT NULL::uuid, p_new_quantity numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid:=gen_random_uuid();
  v_before_from numeric;
  v_after_from numeric;
  v_before_to numeric;
  v_after_to numeric;
  v_site uuid:=public.current_app_site_v21138('inventory');
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active is distinct from false) then
    raise exception 'Active user required';
  end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if not exists(select 1 from public.items where id=p_item_id and active and site_id=v_site) then
    raise exception 'Item not found at this site';
  end if;
  if p_from_location_id is not null and not exists(
    select 1 from public.stock_locations
    where id=p_from_location_id and site_id=v_site and active=true
  ) then
    raise exception 'Source location is not in the selected site';
  end if;
  if p_to_location_id is not null and not exists(
    select 1 from public.stock_locations
    where id=p_to_location_id and site_id=v_site and active=true
  ) then
    raise exception 'Destination location is not in the selected site';
  end if;

  if p_type='ADD' then
    if p_to_location_id is null or p_quantity<=0 then
      raise exception 'ADD requires destination and quantity > 0';
    end if;
    insert into public.stock_balances(item_id,location_id,quantity,site_id)
    values(p_item_id,p_to_location_id,p_quantity,v_site)
    on conflict(item_id,location_id) do update
      set quantity=public.stock_balances.quantity+excluded.quantity,updated_at=now()
    returning quantity into v_after_to;
    v_before_to:=v_after_to-p_quantity;

  elsif p_type='USE' then
    if p_from_location_id is null or p_quantity<=0 then
      raise exception 'USE requires source and quantity > 0';
    end if;
    update public.stock_balances
      set quantity=quantity-p_quantity,updated_at=now()
    where item_id=p_item_id and location_id=p_from_location_id
      and site_id=v_site and quantity>=p_quantity
    returning quantity+p_quantity,quantity into v_before_from,v_after_from;
    if not found then raise exception 'Insufficient stock at source location'; end if;

  elsif p_type='MOVE' then
    if p_from_location_id is null or p_to_location_id is null
       or p_from_location_id=p_to_location_id or p_quantity<=0 then
      raise exception 'MOVE requires different source/destination and quantity > 0';
    end if;
    update public.stock_balances
      set quantity=quantity-p_quantity,updated_at=now()
    where item_id=p_item_id and location_id=p_from_location_id
      and site_id=v_site and quantity>=p_quantity
    returning quantity+p_quantity,quantity into v_before_from,v_after_from;
    if not found then raise exception 'Insufficient stock at source location'; end if;

    insert into public.stock_balances(item_id,location_id,quantity,site_id)
    values(p_item_id,p_to_location_id,p_quantity,v_site)
    on conflict(item_id,location_id) do update
      set quantity=public.stock_balances.quantity+excluded.quantity,updated_at=now()
    returning quantity into v_after_to;
    v_before_to:=v_after_to-p_quantity;

  elsif p_type='ADJUST' then
    if p_from_location_id is null or p_new_quantity is null or p_new_quantity<0 then
      raise exception 'ADJUST requires location and new quantity >= 0';
    end if;
    select quantity into v_before_from
    from public.stock_balances
    where item_id=p_item_id and location_id=p_from_location_id and site_id=v_site
    for update;
    v_before_from:=coalesce(v_before_from,0);

    insert into public.stock_balances(item_id,location_id,quantity,site_id)
    values(p_item_id,p_from_location_id,p_new_quantity,v_site)
    on conflict(item_id,location_id) do update
      set quantity=excluded.quantity,updated_at=now();
    v_after_from:=p_new_quantity;
    p_quantity:=abs(v_after_from-v_before_from);
  else
    raise exception 'Unsupported transaction type';
  end if;

  insert into public.transactions(
    id,item_id,transaction_type,quantity,from_location_id,to_location_id,
    before_from,after_from,before_to,after_to,reason,reference,notes,user_id,site_id
  )
  values(
    v_id,p_item_id,p_type,p_quantity,p_from_location_id,p_to_location_id,
    v_before_from,v_after_from,v_before_to,v_after_to,p_reason,p_reference,p_notes,auth.uid(),v_site
  );
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.consume_safety_bridge_final_warning_v852(p_item_id uuid, p_state_key text, p_attempted_quantity numeric DEFAULT NULL::numeric, p_safety_snapshot jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inserted boolean:=false;
  v_site uuid:=public.current_app_site_v21138('inventory');
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if p_item_id is null or not exists(
    select 1 from public.items where id=p_item_id and site_id=v_site
  ) then raise exception 'Inventory item not found at this site'; end if;
  if nullif(btrim(coalesce(p_state_key,'')),'') is null then
    raise exception 'Safety state key is required';
  end if;

  insert into public.safety_bridge_final_warning_uses_v852(
    user_id,item_id,state_key,safety_snapshot,site_id
  )
  values(auth.uid(),p_item_id,p_state_key,coalesce(p_safety_snapshot,'{}'::jsonb),v_site)
  on conflict(user_id,item_id,state_key) do nothing;
  get diagnostics v_inserted=row_count;

  if v_inserted then
    insert into public.safety_bridge_events(
      item_id,user_id,event_type,attempted_quantity,safety_snapshot,site_id
    )
    values(
      p_item_id,auth.uid(),'FINAL_WARNING_USE',p_attempted_quantity,
      coalesce(p_safety_snapshot,'{}'::jsonb),v_site
    );
  end if;
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_stocktake_task(p_force boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enabled boolean;
  v_interval integer;
  v_item_count integer;
  v_high integer;
  v_stale integer;
  v_due integer;
  v_next timestamptz;
  v_last timestamptz;
  v_task uuid;
  v_user uuid;
  v_site uuid:=public.current_app_site_v21138('inventory');
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active is distinct from false) then
    raise exception 'Active user required';
  end if;
  if coalesce(p_force,false) and not public.is_inventory_admin_v836() then
    raise exception 'Admin access required to force a stocktake';
  end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;

  select enabled,interval_days,item_count,high_usage_count,stagnant_count,due_days,next_task_at
  into v_enabled,v_interval,v_item_count,v_high,v_stale,v_due,v_next
  from public.stocktake_settings where singleton=true and site_id=v_site;
  if not found or not coalesce(v_enabled,false) then return null; end if;

  update public.stocktake_tasks set status='OVERDUE'
  where site_id=v_site and status='OPEN' and due_at<now();

  select id into v_task from public.stocktake_tasks
  where site_id=v_site and status in ('OPEN','OVERDUE')
  order by created_at desc limit 1;
  if v_task is not null then return v_task; end if;

  if not p_force and v_next is not null and v_next>now() then return null; end if;
  select max(created_at) into v_last
  from public.stocktake_tasks
  where site_id=v_site and status<>'CANCELLED';
  if not p_force and v_last is not null and v_last+make_interval(days=>v_interval)>now() then
    return null;
  end if;

  select p.id into v_user
  from public.profiles p
  join public.app_module_access a
    on a.user_id=p.id and a.module_key='inventory' and a.enabled=true
  join public.app_site_access_v21137 sa
    on sa.user_id=p.id and sa.module_key='inventory' and sa.site_id=v_site and sa.enabled=true
  where coalesce(p.active,true)=true
    and coalesce(a.role_override,case when p.role::text='staff' then 'user' else p.role::text end)<>'viewer'
  order by coalesce((
    select max(t.created_at)
    from public.stocktake_tasks t
    where t.site_id=v_site and t.assigned_user_id=p.id
  ),'1970-01-01'::timestamptz),random()
  limit 1;
  if v_user is null then return null; end if;

  insert into public.stocktake_tasks(assigned_user_id,due_at,site_id)
  values(v_user,now()+make_interval(days=>v_due),v_site)
  returning id into v_task;

  update public.stocktake_settings
    set next_task_at=now()+make_interval(days=>v_interval),updated_at=now()
  where singleton=true and site_id=v_site;

  with positions as (
    select distinct on (b.item_id) b.item_id,b.location_id,b.quantity
    from public.stock_balances b
    join public.items i on i.id=b.item_id and i.active=true and i.site_id=v_site
    where b.site_id=v_site and b.quantity>0
    order by b.item_id,b.quantity desc
  ), metrics as (
    select p.*,
      coalesce((
        select sum(t.quantity)
        from public.transactions t
        where t.site_id=v_site and t.item_id=p.item_id and t.transaction_type='USE'
          and t.occurred_at>=now()-interval '90 days'
          and not coalesce(t.exclude_from_usage,false)
          and (not t.legacy_import or coalesce(t.legacy_classification,'USE')='USE')
      ),0) usage90,
      (
        select max(t.occurred_at)
        from public.transactions t
        where t.site_id=v_site and t.item_id=p.item_id
      ) last_move
    from positions p
  ), high as (
    select * from metrics where usage90>0 order by usage90 desc,random()
    limit greatest(v_high,0)
  ), stale as (
    select * from metrics m
    where not exists(select 1 from high h where h.item_id=m.item_id)
    order by last_move nulls first,random()
    limit greatest(v_stale,0)
  ), picked as (
    select * from high union all select * from stale
  ), rnd as (
    select * from metrics m
    where not exists(select 1 from picked p where p.item_id=m.item_id)
    order by random()
    limit greatest(v_item_count-(select count(*) from picked),0)
  ), final_pick as (
    select * from picked union all select * from rnd
  )
  insert into public.stocktake_task_items(task_id,item_id,location_id,expected_quantity,site_id)
  select v_task,item_id,location_id,quantity,v_site
  from final_pick limit v_item_count;

  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_safety_bridge_overdue_gate_v852(p_item_id uuid, p_state_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if p_item_id is null or not exists(
    select 1 from public.items where id=p_item_id and site_id=v_site
  ) then raise exception 'Inventory item not found at this site'; end if;
  if nullif(btrim(coalesce(p_state_key,'')),'') is null then
    raise exception 'Safety state key is required';
  end if;

  if exists(
    select 1
    from public.safety_bridge_final_warning_uses_v852 g
    where g.user_id=auth.uid()
      and g.item_id=p_item_id
      and g.state_key=p_state_key
      and g.site_id=v_site
  ) then
    return 'BLOCKED';
  end if;
  return 'FINAL_WARNING';
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(
    select 1 from public.profiles
    where id=auth.uid()
      and active is distinct from false
      and role='admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_manager_or_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(
    select 1 from public.profiles
    where id=auth.uid()
      and active is distinct from false
      and role in ('admin','manager')
  );
$function$;

CREATE OR REPLACE FUNCTION public.record_safety_bridge_event_v836(p_item_id uuid, p_event_type text, p_attempted_quantity numeric, p_safety_snapshot jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_site uuid:=public.current_app_site_v21138('inventory');
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if upper(coalesce(p_event_type,'')) not in (
    'TRAINING_BLOCKED','USE_CANCELLED','RECHECK_PASSED','CHECK_ERROR',
    'DUE_SOON_WARNING','FINAL_WARNING_SHOWN'
  ) then raise exception 'Invalid safety event'; end if;
  if not exists(select 1 from public.items where id=p_item_id and site_id=v_site) then
    raise exception 'Inventory item not found at this site';
  end if;

  insert into public.safety_bridge_events(
    item_id,user_id,event_type,attempted_quantity,safety_snapshot,site_id
  )
  values(
    p_item_id,auth.uid(),upper(p_event_type),p_attempted_quantity,
    coalesce(p_safety_snapshot,'{}'::jsonb),v_site
  )
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reset_safety_bridge_final_warning_v852(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  delete from public.safety_bridge_final_warning_uses_v852
  where user_id=auth.uid() and item_id=p_item_id and site_id=v_site;
end;
$function$;

CREATE OR REPLACE FUNCTION public.safety_bridge_event_report_v836(p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, event_type text, attempted_quantity numeric, item_id uuid, item_name text, user_id uuid, user_name text, safety_snapshot jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if not exists(
    select 1 from public.profiles p
    where p.id=auth.uid()
      and p.active is distinct from false
      and p.role in ('admin','manager')
  ) then
    raise exception 'Manager or Admin access required';
  end if;

  return query
  select e.id,e.created_at,e.event_type,e.attempted_quantity,
         e.item_id,i.name,e.user_id,coalesce(p.display_name,p.email,'Unknown'),
         e.safety_snapshot
  from public.safety_bridge_events e
  left join public.items i on i.id=e.item_id and i.site_id=v_site
  left join public.profiles p on p.id=e.user_id
  where e.site_id=v_site
  order by e.created_at desc
  limit greatest(1,least(coalesce(p_limit,100),500));
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_safety_bridge_feedback_v843(p_item_id uuid, p_target_kind text, p_safety_target_id uuid, p_safety_reference text, p_safety_title text, p_safety_type text, p_decision text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item public.items%rowtype;
  v_decision text:=upper(btrim(coalesce(p_decision,'')));
  v_site uuid:=public.current_app_site_v21138('inventory');
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_inventory_admin_v836() then raise exception 'Admin access required'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if v_decision not in ('APPROVED','REJECTED') then
    raise exception 'Decision must be APPROVED or REJECTED';
  end if;
  if upper(coalesce(p_target_kind,'')) not in ('DOCUMENT','TRAINING') then
    raise exception 'Invalid safety target type';
  end if;

  select * into v_item
  from public.items
  where id=p_item_id and site_id=v_site;
  if v_item.id is null then raise exception 'Inventory item not found at this site'; end if;

  insert into public.safety_bridge_link_feedback(
    item_id,target_kind,safety_target_id,safety_reference,safety_title,safety_type,
    item_name_snapshot,item_category_snapshot,decision,decided_by,decided_at,site_id
  )
  values(
    p_item_id,upper(p_target_kind),p_safety_target_id,
    nullif(btrim(coalesce(p_safety_reference,'')),''),
    btrim(coalesce(p_safety_title,'')),
    nullif(btrim(coalesce(p_safety_type,'')),''),
    v_item.name,v_item.category,v_decision,auth.uid(),now(),v_site
  )
  on conflict(item_id,target_kind,safety_target_id) do update set
    safety_reference=excluded.safety_reference,
    safety_title=excluded.safety_title,
    safety_type=excluded.safety_type,
    item_name_snapshot=excluded.item_name_snapshot,
    item_category_snapshot=excluded.item_category_snapshot,
    decision=excluded.decision,
    decided_by=excluded.decided_by,
    decided_at=excluded.decided_at,
    site_id=excluded.site_id;
end;
$function$;


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
