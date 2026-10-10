-- Inventory v8.7.4: active app membership, effective roles and policy consolidation.
CREATE OR REPLACE FUNCTION public.current_app_site_v21138(p_module_key text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with wanted as (select lower(btrim(coalesce(p_module_key,''))) module_key),
  chosen as (
    select c.site_id,1 ord
    from public.app_current_site_v21138 c
    cross join wanted w
    join public.organisation_sites_v21137 s on s.id=c.site_id and s.active=true
    where c.user_id=auth.uid() and c.module_key=w.module_key
      and exists(
        select 1 from public.app_module_access a
        where a.user_id=auth.uid() and a.module_key=w.module_key and a.enabled=true
      )
      and (
        exists(
          select 1 from public.app_site_access_v21137 sa
          where sa.user_id=auth.uid() and sa.module_key=w.module_key
            and sa.site_id=c.site_id and sa.enabled=true
        )
        or exists(
          select 1 from public.app_module_access a
          where a.user_id=auth.uid() and a.module_key=w.module_key and a.enabled=true
            and (
              coalesce(a.role_override,'')='admin'
              or 'admin'=any(coalesce(a.allowed_roles,'{}'::text[]))
            )
        )
      )
    union all
    select a.home_site_id,2
    from public.app_module_access a
    cross join wanted w
    join public.organisation_sites_v21137 s on s.id=a.home_site_id and s.active=true
    where a.user_id=auth.uid() and a.module_key=w.module_key and a.enabled=true
      and a.home_site_id is not null
    union all
    select sa.site_id,3
    from public.app_site_access_v21137 sa
    cross join wanted w
    join public.organisation_sites_v21137 s on s.id=sa.site_id and s.active=true
    where sa.user_id=auth.uid() and sa.module_key=w.module_key and sa.enabled=true
    union all
    select s.id,4
    from public.organisation_sites_v21137 s
    cross join wanted w
    where s.active=true
      and exists(
        select 1 from public.app_module_access a
        where a.user_id=auth.uid() and a.module_key=w.module_key and a.enabled=true
          and (
            coalesce(a.role_override,'')='admin'
            or 'admin'=any(coalesce(a.allowed_roles,'{}'::text[]))
          )
      )
  )
  select site_id from chosen where site_id is not null
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true)
    and exists(select 1 from public.app_module_access a cross join wanted w where a.user_id=auth.uid() and a.module_key=w.module_key and a.enabled=true)
    order by ord limit 1
$function$;

create or replace function public.inventory_site_for_caller_v21138() returns uuid language sql stable security definer set search_path=public as $$ select public.current_app_site_v21138('inventory') $$;
create or replace function public.is_inventory_admin_v836() returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from public.profiles p join public.app_module_access a on a.user_id=p.id and a.module_key='inventory' and a.enabled=true
left join public.app_site_access_v21137 s on s.user_id=p.id and s.module_key='inventory' and s.site_id=public.current_app_site_v21138('inventory') and s.enabled=true
where p.id=auth.uid() and p.active=true and public.current_app_site_v21138('inventory') is not null
and coalesce(s.role_override,a.role_override,case when p.role::text='staff' then 'user' else p.role::text end) in ('admin')) $$;
create or replace function public.is_manager_or_admin() returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from public.profiles p join public.app_module_access a on a.user_id=p.id and a.module_key='inventory' and a.enabled=true
left join public.app_site_access_v21137 s on s.user_id=p.id and s.module_key='inventory' and s.site_id=public.current_app_site_v21138('inventory') and s.enabled=true
where p.id=auth.uid() and p.active=true and public.current_app_site_v21138('inventory') is not null
and coalesce(s.role_override,a.role_override,case when p.role::text='staff' then 'user' else p.role::text end) in ('admin','manager')) $$;
CREATE OR REPLACE FUNCTION public.apply_client_stock_transaction(p_item_id uuid, p_type text, p_quantity numeric, p_from_location_id uuid, p_to_location_id uuid, p_new_quantity numeric, p_reason text, p_client_reference text, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid:=public.current_app_site_v21138('inventory');
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active user required'; end if;
  if p_client_reference is null or p_client_reference not like 'CLIENT:%' then raise exception 'Valid client reference required'; end if;
  if exists(select 1 from public.transactions where reference=p_client_reference and site_id=v_site) then return; end if;
  perform public.apply_stock_transaction(
    p_item_id=>p_item_id,p_type=>p_type::public.transaction_type,p_quantity=>p_quantity,
    p_from_location_id=>p_from_location_id,p_to_location_id=>p_to_location_id,p_new_quantity=>p_new_quantity,
    p_reason=>p_reason,p_reference=>p_client_reference,p_notes=>p_notes
  );
end;
$function$;

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

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if not exists(select 1 from public.profiles p join public.app_module_access a on a.user_id=p.id and a.module_key='inventory' and a.enabled=true left join public.app_site_access_v21137 s on s.user_id=p.id and s.module_key='inventory' and s.site_id=public.current_app_site_v21138('inventory') and s.enabled=true where p.id=auth.uid() and coalesce(s.role_override,a.role_override,case when p.role::text='staff' then 'user' else p.role::text end)<>'viewer') then raise exception 'Inventory write access required'; end if;
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

CREATE OR REPLACE FUNCTION public.apply_use_stock_from_location_v845(p_item_id uuid, p_location_name text, p_quantity numeric, p_reason text, p_client_reference text, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_available numeric;
  v_remaining numeric;
  v_take numeric;
  v_step integer:=0;
  v_default_location_id uuid;
  v_row record;
  v_ref text;
  v_site uuid:=public.current_app_site_v21138('inventory');
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active user required'; end if;
  if p_client_reference is null or p_client_reference not like 'CLIENT:%' then raise exception 'Valid client reference required'; end if;
  if coalesce(btrim(p_location_name),'')='' then raise exception 'Location is required'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'Quantity must be greater than zero'; end if;

  if exists(
    select 1 from public.transactions
    where site_id=v_site and (reference=p_client_reference or reference like p_client_reference||':%')
  ) then return; end if;

  select default_location_id into v_default_location_id
  from public.items where id=p_item_id and active=true and site_id=v_site;
  if not found then raise exception 'Item not found at this site'; end if;

  perform 1
  from public.stock_balances sb
  join public.stock_locations sl on sl.id=sb.location_id and sl.site_id=v_site
  where sb.site_id=v_site and sb.item_id=p_item_id and sb.quantity>0 and sl.active=true
    and lower(btrim(sl.location_name))=lower(btrim(p_location_name))
  for update of sb;

  select coalesce(sum(sb.quantity),0) into v_available
  from public.stock_balances sb
  join public.stock_locations sl on sl.id=sb.location_id and sl.site_id=v_site
  where sb.site_id=v_site and sb.item_id=p_item_id and sb.quantity>0 and sl.active=true
    and lower(btrim(sl.location_name))=lower(btrim(p_location_name));

  if v_available<p_quantity then raise exception 'Only % is available at this location',v_available; end if;
  v_remaining:=p_quantity;

  for v_row in
    select sb.location_id,sb.quantity,coalesce(sl.area_name,'') area_name,
           coalesce(sl.bin_code,'') bin_code,sl.created_at
    from public.stock_balances sb
    join public.stock_locations sl on sl.id=sb.location_id and sl.site_id=v_site
    where sb.site_id=v_site and sb.item_id=p_item_id and sb.quantity>0 and sl.active=true
      and lower(btrim(sl.location_name))=lower(btrim(p_location_name))
    order by case when sb.location_id=v_default_location_id then 0 else 1 end,
      lower(coalesce(nullif(btrim(sl.bin_code),''),nullif(btrim(sl.area_name),''),'')),sl.created_at
  loop
    exit when v_remaining<=0;
    v_take:=least(v_remaining,v_row.quantity);
    if v_take<=0 then continue; end if;
    v_step:=v_step+1;
    v_ref:=case when v_step=1 then p_client_reference else p_client_reference||':'||v_step::text end;
    perform public.apply_stock_transaction(
      p_item_id=>p_item_id,p_type=>'USE'::public.transaction_type,p_quantity=>v_take,
      p_from_location_id=>v_row.location_id,p_to_location_id=>null,p_new_quantity=>null,
      p_reason=>p_reason,p_reference=>v_ref,p_notes=>p_notes
    );
    v_remaining:=v_remaining-v_take;
  end loop;
  if v_remaining>0 then raise exception 'Unable to allocate the full quantity from this location'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assess_item_risk(p_item_id uuid, p_rating text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rating text := upper(coalesce(trim(p_rating),'NONE'));
  v_old text;
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if auth.uid() is null or not public.is_inventory_admin_v836() then raise exception 'Admin access required'; end if;
  if v_rating not in ('NONE','GREEN','AMBER','RED') then raise exception 'Invalid risk rating'; end if;
  select coalesce(risk_rating,'NONE') into v_old from public.items where id=p_item_id and site_id=public.current_app_site_v21138('inventory') for update;
  if not found then raise exception 'Item not found'; end if;
  perform set_config('inventory.risk_reason',coalesce(p_reason,''),true);
  update public.items
     set risk_rating=v_rating,
         risk_rating_updated_at=now(),
         risk_assessed_at=now(),
         risk_assessed_by=auth.uid(),
         updated_at=now()
   where id=p_item_id;
  if v_old=v_rating then
    insert into public.risk_rating_history(item_id,old_rating,new_rating,changed_by,reason)
    values(p_item_id,v_old,v_rating,auth.uid(),coalesce(nullif(p_reason,''),'Risk assessment confirmed'));
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.clean_site_counts_v21138(p_site_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_energy uuid;
  out jsonb;
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if not exists(
    select 1 from public.app_site_access_v21137
    where user_id=auth.uid() and site_id=p_site_id and enabled=true
  ) and not public.is_admin() then
    raise exception 'Site access required';
  end if;

  select legacy_energy_site_id into v_energy from public.organisation_sites_v21137 where id=p_site_id;
  if not found then raise exception 'Site not found'; end if;

  out:=jsonb_build_object(
    'inventory',jsonb_build_object(
      'items',(select count(*) from public.items where site_id=p_site_id),
      'stock_locations',(select count(*) from public.stock_locations where site_id=p_site_id),
      'stock_balances',(select count(*) from public.stock_balances where site_id=p_site_id),
      'transactions',(select count(*) from public.transactions where site_id=p_site_id),
      'purchase_orders',(select count(*) from public.purchase_orders where site_id=p_site_id)
    ),
    'energy',jsonb_build_object(
      'meters',(select count(*) from public.energy_meters where site_id=v_energy),
      'invoices',(select count(*) from public.energy_invoices where site_id=v_energy),
      'meter_reads',(select count(*) from public.energy_meter_reads where site_id=v_energy),
      'half_hour_reads',(select count(*) from public.energy_half_hour_reads where site_id=v_energy),
      'generation',(select count(*) from public.energy_generation where site_id=v_energy),
      'occupancy',(select count(*) from public.energy_occupancy where site_id=v_energy)
    )
  );
  return out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_stocktake_task_v870(p_task_id uuid, p_counts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_site uuid := public.current_app_site_v21138('inventory');
  v_assigned uuid;
  v_status text;
  v_expected_lines integer;
  v_payload_lines integer;
  v_adjusted integer := 0;
  v_now timestamptz := now();
  v_line record;
  v_current numeric;
  v_counted numeric;
  v_tx uuid;
  v_name text;
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if not exists(select 1 from public.profiles p join public.app_module_access a on a.user_id=p.id and a.module_key='inventory' and a.enabled=true left join public.app_site_access_v21137 s on s.user_id=p.id and s.module_key='inventory' and s.site_id=public.current_app_site_v21138('inventory') and s.enabled=true where p.id=auth.uid() and coalesce(s.role_override,a.role_override,case when p.role::text='staff' then 'user' else p.role::text end)<>'viewer') then raise exception 'Inventory write access required'; end if;
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if v_site is null then
    raise exception 'No Inventory site selected';
  end if;
  if jsonb_typeof(p_counts) is distinct from 'array' then
    raise exception 'Stocktake counts are missing or invalid';
  end if;

  select assigned_user_id,status
    into v_assigned,v_status
  from public.stocktake_tasks
  where id=p_task_id and site_id=v_site
  for update;

  if not found then
    raise exception 'Stocktake task not found at this site';
  end if;
  if v_status not in ('OPEN','OVERDUE') then
    raise exception 'This stocktake is no longer open';
  end if;
  if v_assigned<>auth.uid() and not public.is_inventory_admin_v836() then
    raise exception 'This stocktake is assigned to another user';
  end if;

  select count(*) into v_expected_lines
  from public.stocktake_task_items
  where task_id=p_task_id and site_id=v_site and completed_at is null;

  select count(*) into v_payload_lines
  from jsonb_array_elements(p_counts);

  if v_expected_lines=0 then
    raise exception 'This stocktake has no open lines';
  end if;
  if v_payload_lines<>v_expected_lines then
    raise exception 'Enter a counted quantity for every stocktake item';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_counts) x
    where nullif(x->>'id','') is null
       or nullif(x->>'counted','') is null
       or (x->>'counted')::numeric < 0
  ) then
    raise exception 'Every stocktake line needs a valid count of zero or more';
  end if;

  if (
    select count(distinct (x->>'id')::uuid)
    from jsonb_array_elements(p_counts) x
  ) <> v_expected_lines then
    raise exception 'Stocktake counts contain a duplicate or missing line';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_counts) x
    where not exists (
      select 1
      from public.stocktake_task_items sti
      where sti.id=(x->>'id')::uuid
        and sti.task_id=p_task_id
        and sti.site_id=v_site
        and sti.completed_at is null
    )
  ) then
    raise exception 'One or more stocktake lines no longer belong to this task';
  end if;

  for v_line in
    select
      sti.id,
      sti.item_id,
      sti.location_id,
      sti.expected_quantity,
      (x->>'counted')::numeric as counted
    from public.stocktake_task_items sti
    join lateral jsonb_array_elements(p_counts) x
      on (x->>'id')::uuid=sti.id
    where sti.task_id=p_task_id
      and sti.site_id=v_site
      and sti.completed_at is null
    order by sti.id
  loop
    v_counted:=v_line.counted;

    -- Ensure there is always a balance row to lock, even for a zero balance.
    insert into public.stock_balances(item_id,location_id,quantity,site_id)
    values(v_line.item_id,v_line.location_id,0,v_site)
    on conflict(item_id,location_id) do nothing;

    select quantity into v_current
    from public.stock_balances
    where item_id=v_line.item_id
      and location_id=v_line.location_id
      and site_id=v_site
    for update;

    v_current:=coalesce(v_current,0);

    -- expected_quantity is refreshed when the task is opened. If live stock
    -- changed after that point, do not overwrite the legitimate movement.
    if v_current is distinct from v_line.expected_quantity then
      select name into v_name from public.items where id=v_line.item_id;
      raise exception 'STOCKTAKE_CHANGED: % changed while you were counting (expected %, now %). Refresh and recount this line.',
        coalesce(v_name,'Item'),v_line.expected_quantity,v_current;
    end if;

    v_tx:=null;
    if v_counted is distinct from v_current then
      v_tx:=public.apply_stock_transaction(
        v_line.item_id,
        'ADJUST'::public.transaction_type,
        0,
        v_line.location_id,
        null,
        v_counted,
        'Stocktake correction',
        p_task_id::text,
        'Random scheduled stocktake'
      );
      v_adjusted:=v_adjusted+1;
    end if;

    update public.stocktake_task_items
    set counted_quantity=v_counted,
        discrepancy=v_counted-v_line.expected_quantity,
        adjusted_transaction_id=v_tx,
        completed_at=v_now
    where id=v_line.id
      and task_id=p_task_id
      and site_id=v_site
      and completed_at is null;
  end loop;

  update public.stocktake_tasks
  set status='COMPLETED',
      completed_at=v_now,
      completed_by=auth.uid()
  where id=p_task_id
    and site_id=v_site
    and status in ('OPEN','OVERDUE');

  return jsonb_build_object(
    'task_id',p_task_id,
    'completed_at',v_now,
    'lines',v_expected_lines,
    'adjustments',v_adjusted
  );
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

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
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

CREATE OR REPLACE FUNCTION public.create_clean_site_v21138(p_name text, p_timezone text DEFAULT 'Europe/London'::text)
 RETURNS TABLE(site_id uuid, energy_site_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text:=btrim(coalesce(p_name,''));
  v_tz text:=coalesce(nullif(btrim(coalesce(p_timezone,'')),''),'Europe/London');
  v_site uuid;
  v_energy uuid;
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required'; end if;
  if length(v_name)<2 then raise exception 'Site name is required'; end if;
  if exists(select 1 from public.organisation_sites_v21137 where lower(name)=lower(v_name)) then
    raise exception 'A site with this name already exists';
  end if;

  v_site:=md5('hotel-site-v21138:'||lower(v_name))::uuid;

  insert into public.energy_sites(name,timezone,active,module_settings)
  values(v_name,v_tz,true,'{}'::jsonb)
  returning id into v_energy;

  insert into public.organisation_sites_v21137(id,name,active,timezone,legacy_energy_site_id,created_by)
  values(v_site,v_name,true,v_tz,v_energy,auth.uid());

  insert into public.inventory_settings(site_id,singleton,offline_mode_enabled,updated_at,updated_by)
  values(v_site,true,true,now(),auth.uid());

  insert into public.stocktake_settings(
    site_id,singleton,enabled,interval_days,item_count,high_usage_count,stagnant_count,due_days,next_task_at,updated_at
  )
  values(v_site,true,false,14,12,4,4,7,now()+interval '14 days',now());

  insert into public.safety_bridge_settings(site_id,singleton,enabled,safety_tracker_url,updated_at,updated_by)
  values(v_site,true,false,'https://grich295.github.io/Safety-tracker/',now(),auth.uid());

  insert into public.inventory_categories(site_id,name,sort_order,active)
  values
    (v_site,'Bulbs',10,true),
    (v_site,'Plumbing',20,true),
    (v_site,'Electrical',30,true),
    (v_site,'Batteries',40,true);

  insert into public.site_module_status_v21138(site_id,module_key,status,note)
  values
    (v_site,'inventory','READY','Clean Inventory site: default settings/categories only; no operational records copied.'),
    (v_site,'energy','SETUP_REQUIRED','Clean Energy site: site shell only; configure utilities/meters before importing data.')
  on conflict(site_id,module_key) do update set status=excluded.status,note=excluded.note,updated_at=now();

  insert into public.app_site_access_v21137(user_id,module_key,site_id,enabled,role_override,is_home,updated_at,updated_by)
  select a.user_id,a.module_key,v_site,true,'admin',false,now(),auth.uid()
  from public.app_module_access a
  join public.profiles p on p.id=a.user_id and p.active=true
  where a.enabled=true
    and a.module_key in ('inventory','energy')
    and (coalesce(a.role_override,'')='admin' or 'admin'=any(coalesce(a.allowed_roles,'{}'::text[])))
  on conflict(user_id,module_key,site_id) do update
  set enabled=true,role_override='admin',updated_at=now(),updated_by=auth.uid();

  return query select v_site,v_energy;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_inventory_push_subscription_v872(p_endpoint text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from public.inventory_push_subscriptions
  where endpoint=p_endpoint and user_id=auth.uid();
end;
$function$;

CREATE OR REPLACE FUNCTION public.energy_import_legacy_actuals(p_site_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb;
  v_utility text;
  v_month date;
  v_end date;
  v_usage numeric;
  v_net numeric;
  v_vat_pct numeric;
  v_vat numeric;
  v_gross numeric;
  v_invoice_number text;
  v_existing_id uuid;
  v_has_real boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_invalid integer := 0;
  v_no_vat integer := 0;
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if auth.uid() is null or not public.energy_can_write() then
    raise exception 'Energy write access required';
  end if;

  if p_site_id is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Site and rows are required';
  end if;

  if p_site_id is distinct from public.current_energy_site_v21138() then
    raise exception 'Selected Energy site access required';
  end if;
  for r in select value from jsonb_array_elements(p_rows)
  loop
    begin
      v_utility := lower(trim(coalesce(r->>'utility_type','')));
      v_month := (r->>'period_month')::date;
      v_usage := nullif(r->>'consumption','')::numeric;
      v_net := nullif(r->>'net_total','')::numeric;
    exception when others then
      v_invalid := v_invalid + 1;
      continue;
    end;

    if v_utility not in ('electricity','gas','water','sewerage')
       or v_month is null
       or v_usage is null or v_usage <= 0
       or v_net is null or v_net < 0 then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    v_month := date_trunc('month',v_month)::date;
    v_end := (v_month + interval '1 month - 1 day')::date;

    select exists(
      select 1
      from public.energy_invoices i
      where i.site_id=p_site_id
        and lower(coalesce(i.utility_type,''))=v_utility
        and coalesce(i.supplier_key,'') <> 'legacy'
        and (
          i.review_status='confirmed'
          or nullif(i.review_detail->>'confirmed_at','') is not null
        )
        and coalesce(
          date_trunc('month',i.relevant_month)::date,
          date_trunc('month',i.period_start)::date,
          date_trunc('month',i.invoice_date)::date
        )=v_month
    ) into v_has_real;

    if v_has_real then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select vr.vat_pct
      into v_vat_pct
    from public.energy_utility_vat_rates vr
    where vr.site_id=p_site_id
      and lower(vr.utility_type)=v_utility
      and vr.effective_from<=v_end
    order by vr.effective_from desc
    limit 1;

    if v_vat_pct is null then
      v_vat := null;
      v_gross := null;
      v_no_vat := v_no_vat + 1;
    else
      v_vat := round(v_net*v_vat_pct/100,2);
      v_gross := round(v_net+v_vat,2);
    end if;

    v_invoice_number :=
      to_char(v_month,'Mon YYYY') || ' ' ||
      case v_utility
        when 'electricity' then 'Elec'
        when 'gas' then 'Gas'
        when 'water' then 'Water'
        else 'Sewerage'
      end;

    select i.id into v_existing_id
    from public.energy_invoices i
    where i.site_id=p_site_id
      and i.supplier_key='legacy'
      and lower(i.utility_type)=v_utility
      and i.period_start=v_month
    limit 1;

    insert into public.energy_invoices(
      id,site_id,supplier,supplier_key,invoice_number,invoice_date,
      period_start,period_end,relevant_month,utility_type,meter_id,meter_count,
      consumption,unit_rate,standing_charge,ccl,other_charges,
      net_total,vat,gross_total,water_supply_charge,sewerage_charge,
      water_volume_m3,sewerage_volume_m3,notes,review_status,
      extraction_confidence,review_detail
    )
    values(
      coalesce(v_existing_id,gen_random_uuid()),p_site_id,'Legacy','legacy',
      v_invoice_number,v_end,v_month,v_end,v_month,v_utility,null,null,
      v_usage,null,null,null,null,
      v_net,v_vat,v_gross,
      case when v_utility='water' then v_net else null end,
      case when v_utility='sewerage' then v_net else null end,
      case when v_utility='water' then v_usage else null end,
      case when v_utility='sewerage' then v_usage else null end,
      'Legacy monthly actual imported from historical spreadsheet. Gas/water may be combined across meters.',
      'confirmed','manual',
      jsonb_build_object(
        'source','legacy_bulk_import',
        'confirmed_at',now(),
        'legacy_actual',true,
        'combined_meter_total',v_utility in ('gas','water'),
        'meter_split_required',false,
        'vat_basis',case when v_vat_pct is null then 'No dated VAT preset' else v_vat_pct::text||'% dated VAT preset' end,
        'effective_net_rate',v_net/v_usage
      )
    )
    on conflict (site_id,utility_type,period_start)
      where supplier_key='legacy'
    do update set
      supplier='Legacy',
      invoice_number=excluded.invoice_number,
      invoice_date=excluded.invoice_date,
      period_end=excluded.period_end,
      relevant_month=excluded.relevant_month,
      consumption=excluded.consumption,
      net_total=excluded.net_total,
      vat=excluded.vat,
      gross_total=excluded.gross_total,
      water_supply_charge=excluded.water_supply_charge,
      sewerage_charge=excluded.sewerage_charge,
      water_volume_m3=excluded.water_volume_m3,
      sewerage_volume_m3=excluded.sewerage_volume_m3,
      notes=excluded.notes,
      review_status='confirmed',
      extraction_confidence='manual',
      review_detail=excluded.review_detail;

    if v_existing_id is null then v_created := v_created + 1;
    else v_updated := v_updated + 1;
    end if;

    insert into public.energy_historic_monthly(
      site_id,period_month,utility_type,meter_id,consumption,unit,
      unit_charge,standing_charge,ccl,other_charges,net_total,notes,
      source_label,is_estimated,updated_at
    )
    values(
      p_site_id,v_month,v_utility,null,v_usage,
      case when v_utility in ('water','sewerage') then 'm3' else 'kWh' end,
      null,null,null,null,v_net,
      'Legacy monthly actual imported from spreadsheet',
      'Legacy bulk actuals',false,now()
    )
    on conflict (site_id,period_month,utility_type)
      where meter_id is null
    do update set
      consumption=excluded.consumption,
      unit=excluded.unit,
      net_total=excluded.net_total,
      notes=excluded.notes,
      source_label='Legacy bulk actuals',
      is_estimated=false,
      updated_at=now();
  end loop;

  return jsonb_build_object(
    'created',v_created,
    'updated',v_updated,
    'skipped_real_invoice',v_skipped,
    'invalid',v_invalid,
    'no_vat',v_no_vat,
    'processed',v_created+v_updated+v_skipped+v_invalid
  );
end;
$function$;

revoke execute on function public.enforce_item_risk_admin() from public,anon,authenticated;
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

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if not exists(select 1 from public.profiles p join public.app_module_access a on a.user_id=p.id and a.module_key='inventory' and a.enabled=true left join public.app_site_access_v21137 s on s.user_id=p.id and s.module_key='inventory' and s.site_id=public.current_app_site_v21138('inventory') and s.enabled=true where p.id=auth.uid() and coalesce(s.role_override,a.role_override,case when p.role::text='staff' then 'user' else p.role::text end)<>'viewer') then raise exception 'Inventory write access required'; end if;
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

CREATE OR REPLACE FUNCTION public.get_inventory_push_public_key_v872()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text;
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select vapid_public_key into v_key
  from public.inventory_push_runtime_config
  where singleton=true and enabled=true;
  return v_key;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_create_stock_position(p_location_name text, p_bin_ref text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_location text;
  v_id uuid;
  v_site uuid:=public.current_app_site_v21138('inventory');
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if not exists(select 1 from public.profiles p join public.app_module_access a on a.user_id=p.id and a.module_key='inventory' and a.enabled=true left join public.app_site_access_v21137 s on s.user_id=p.id and s.module_key='inventory' and s.site_id=public.current_app_site_v21138('inventory') and s.enabled=true where p.id=auth.uid() and coalesce(s.role_override,a.role_override,case when p.role::text='staff' then 'user' else p.role::text end)<>'viewer') then raise exception 'Inventory write access required'; end if;
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;

  select location_name into v_location
  from public.stock_locations
  where site_id=v_site and active=true and lower(location_name)=lower(trim(p_location_name))
  order by case when area_name='' and bin_code='' then 0 else 1 end,created_at
  limit 1;
  if v_location is null then raise exception 'Location not found or inactive at this site'; end if;

  insert into public.stock_locations(site_id,location_name,area_name,bin_code,active)
  values(v_site,v_location,'',trim(coalesce(p_bin_ref,'')),true)
  on conflict(site_id,location_name,area_name,bin_code)
  do update set active=true
  returning id into v_id;
  return v_id;
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

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
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

revoke execute on function public.handle_new_user() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.inventory_watchdog_summary_v872()
 RETURNS TABLE(id uuid, severity text, category text, title text, details jsonb, first_seen_at timestamp with time zone, last_seen_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_manager_or_admin() then raise exception 'Manager or Admin access required'; end if;
  return query
  select w.id,w.severity,w.category,w.title,w.details,w.first_seen_at,w.last_seen_at
  from public.inventory_watchdog_issues w
  where w.site_id=v_site and w.status='OPEN'
  order by case w.severity when 'CRITICAL' then 0 when 'WARN' then 1 else 2 end,
           w.last_seen_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_order_id uuid, p_quantity numeric, p_to_location_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.purchase_orders%rowtype;
  v_new numeric;
  v_tx uuid;
  v_site uuid:=public.current_app_site_v21138('inventory');
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if not exists(select 1 from public.profiles p join public.app_module_access a on a.user_id=p.id and a.module_key='inventory' and a.enabled=true left join public.app_site_access_v21137 s on s.user_id=p.id and s.module_key='inventory' and s.site_id=public.current_app_site_v21138('inventory') and s.enabled=true where p.id=auth.uid() and coalesce(s.role_override,a.role_override,case when p.role::text='staff' then 'user' else p.role::text end)<>'viewer') then raise exception 'Inventory write access required'; end if;
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'Received quantity must be greater than zero'; end if;
  if not exists(select 1 from public.stock_locations where id=p_to_location_id and site_id=v_site and active=true) then
    raise exception 'Destination is not in the selected site';
  end if;

  select * into v_order from public.purchase_orders where id=p_order_id and site_id=v_site for update;
  if not found then raise exception 'Order not found at this site'; end if;
  if v_order.status not in ('OPEN','PART_RECEIVED') then raise exception 'Order is not open for receiving'; end if;
  if p_quantity>(v_order.quantity_ordered-v_order.quantity_received) then raise exception 'Received quantity exceeds quantity still on order'; end if;

  select public.apply_stock_transaction(
    v_order.item_id,'ADD'::public.transaction_type,p_quantity,null,p_to_location_id,null,
    'Purchase order receipt',coalesce(v_order.order_reference,v_order.id::text),p_notes
  ) into v_tx;
  v_new:=v_order.quantity_received+p_quantity;
  update public.purchase_orders
  set quantity_received=v_new,
      status=case when v_new>=quantity_ordered then 'COMPLETED' else 'PART_RECEIVED' end,
      updated_at=now()
  where id=p_order_id and site_id=v_site;
  return v_tx;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_inventory_client_alert_v872(p_alert_type text, p_message text, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
  v_id uuid;
  v_type text:=upper(btrim(coalesce(p_alert_type,'')));
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if v_type not in ('OFFLINE_SYNC_FAILED','IMPORTANT_CLIENT_ERROR') then
    raise exception 'Invalid client alert type';
  end if;
  if nullif(btrim(coalesce(p_message,'')),'') is null then
    raise exception 'Alert message is required';
  end if;

  select id into v_id
  from public.inventory_client_alerts
  where user_id=auth.uid()
    and site_id=v_site
    and alert_type=v_type
    and status='OPEN'
    and created_at>now()-interval '2 hours'
  order by created_at desc limit 1;

  if v_id is not null then
    update public.inventory_client_alerts
    set message=btrim(p_message),details=coalesce(p_details,'{}'::jsonb),updated_at=now()
    where id=v_id;
    return v_id;
  end if;

  insert into public.inventory_client_alerts(
    user_id,site_id,alert_type,message,details
  )
  values(auth.uid(),v_site,v_type,btrim(p_message),coalesce(p_details,'{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
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

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
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

CREATE OR REPLACE FUNCTION public.refresh_stocktake_task_positions_v868(p_task_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
  v_changes integer:=0;
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if not exists(select 1 from public.profiles p join public.app_module_access a on a.user_id=p.id and a.module_key='inventory' and a.enabled=true left join public.app_site_access_v21137 s on s.user_id=p.id and s.module_key='inventory' and s.site_id=public.current_app_site_v21138('inventory') and s.enabled=true where p.id=auth.uid() and coalesce(s.role_override,a.role_override,case when p.role::text='staff' then 'user' else p.role::text end)<>'viewer') then raise exception 'Inventory write access required'; end if;
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;

  if not exists(
    select 1
    from public.stocktake_tasks t
    where t.id=p_task_id
      and t.site_id=v_site
      and t.status in ('OPEN','OVERDUE')
      and t.assigned_user_id=auth.uid()
  ) then
    return 0;
  end if;

  with resolved as (
    select
      sti.id,
      coalesce(
        case when cur.quantity>0 then sti.location_id end,
        best.location_id,
        i.default_location_id,
        sti.location_id
      ) as resolved_location_id
    from public.stocktake_task_items sti
    join public.stocktake_tasks st on st.id=sti.task_id
    join public.items i on i.id=sti.item_id
    left join public.stock_balances cur
      on cur.item_id=sti.item_id
     and cur.location_id=sti.location_id
     and cur.site_id=st.site_id
    left join lateral (
      select b.location_id,b.quantity
      from public.stock_balances b
      where b.site_id=st.site_id
        and b.item_id=sti.item_id
        and b.quantity>0
      order by
        case when b.location_id=i.default_location_id then 0 else 1 end,
        b.quantity desc,
        b.location_id
      limit 1
    ) best on true
    where sti.task_id=p_task_id
      and st.site_id=v_site
      and st.status in ('OPEN','OVERDUE')
  ),
  values_now as (
    select r.id,r.resolved_location_id,coalesce(b.quantity,0) as expected_quantity
    from resolved r
    left join public.stock_balances b
      on b.location_id=r.resolved_location_id
     and b.item_id=(select sti2.item_id from public.stocktake_task_items sti2 where sti2.id=r.id)
     and b.site_id=v_site
  )
  update public.stocktake_task_items sti
  set location_id=v.resolved_location_id,
      expected_quantity=v.expected_quantity
  from values_now v
  where sti.id=v.id
    and (
      sti.location_id is distinct from v.resolved_location_id
      or sti.expected_quantity is distinct from v.expected_quantity
    );

  get diagnostics v_changes=row_count;
  return v_changes;
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

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  delete from public.safety_bridge_final_warning_uses_v852
  where user_id=auth.uid() and item_id=p_item_id and site_id=v_site;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_inventory_client_alert_v872(p_alert_type text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
  v_count integer;
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.inventory_client_alerts
  set status='RESOLVED',updated_at=now()
  where user_id=auth.uid()
    and site_id=v_site
    and alert_type=upper(btrim(coalesce(p_alert_type,'')))
    and status in ('OPEN','SENT');
  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_legacy_transactions(p_ids uuid[], p_classification text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_class text:=upper(coalesce(trim(p_classification),''));
  v_count integer;
  v_site uuid:=public.current_app_site_v21138('inventory');
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if v_class not in ('USE','ADJUSTMENT','DAMAGE_LOSS','TRANSFER','EXCLUDE') then raise exception 'Invalid legacy classification'; end if;
  update public.transactions
  set legacy_classification=v_class,exclude_from_usage=(v_class<>'USE'),
      legacy_reviewed_at=now(),legacy_reviewed_by=auth.uid()
  where id=any(p_ids) and legacy_import=true and site_id=v_site;
  get diagnostics v_count=row_count;
  return v_count;
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

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if not public.is_manager_or_admin() then
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

CREATE OR REPLACE FUNCTION public.save_inventory_push_subscription_v872(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
  v_id uuid;
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active is distinct from false) then
    raise exception 'Active user required';
  end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if nullif(btrim(coalesce(p_endpoint,'')),'') is null
     or nullif(btrim(coalesce(p_p256dh,'')),'') is null
     or nullif(btrim(coalesce(p_auth,'')),'') is null then
    raise exception 'Invalid push subscription';
  end if;

  insert into public.inventory_push_subscriptions(
    user_id,site_id,endpoint,p256dh,auth,user_agent,enabled,updated_at,last_error
  )
  values(
    auth.uid(),v_site,btrim(p_endpoint),btrim(p_p256dh),btrim(p_auth),
    nullif(btrim(coalesce(p_user_agent,'')),''),true,now(),null
  )
  on conflict(endpoint) do update
    set user_id=excluded.user_id,
        site_id=excluded.site_id,
        p256dh=excluded.p256dh,
        auth=excluded.auth,
        user_agent=excluded.user_agent,
        enabled=true,
        updated_at=now(),
        last_error=null
  returning id into v_id;

  return v_id;
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

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
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

CREATE OR REPLACE FUNCTION public.save_safety_bridge_item_link_v836(p_item_id uuid, p_target_kind text, p_safety_target_id uuid, p_safety_reference text, p_safety_title text, p_safety_type text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_site uuid:=public.current_app_site_v21138('inventory');
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_inventory_admin_v836() then raise exception 'Admin access required'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if not exists(select 1 from public.items where id=p_item_id and active=true and site_id=v_site) then raise exception 'Active inventory item not found at this site'; end if;
  if upper(coalesce(p_target_kind,'')) not in ('DOCUMENT','TRAINING') then raise exception 'Invalid safety target type'; end if;
  if nullif(btrim(coalesce(p_safety_title,'')),'') is null then raise exception 'Safety title required'; end if;
  insert into public.safety_bridge_item_links(
    site_id,item_id,target_kind,safety_target_id,safety_reference,safety_title,safety_type,active,linked_by,linked_at
  )
  values(
    v_site,p_item_id,upper(p_target_kind),p_safety_target_id,nullif(btrim(coalesce(p_safety_reference,'')),''),
    btrim(p_safety_title),nullif(btrim(coalesce(p_safety_type,'')),''),true,auth.uid(),now()
  )
  on conflict(item_id,target_kind,safety_target_id) do update set
    safety_reference=excluded.safety_reference,safety_title=excluded.safety_title,safety_type=excluded.safety_type,
    active=true,linked_by=excluded.linked_by,linked_at=excluded.linked_at,site_id=excluded.site_id
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_safety_bridge_settings_v836(p_enabled boolean, p_safety_tracker_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid:=public.current_app_site_v21138('inventory');
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_inventory_admin_v836() then raise exception 'Admin access required'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  insert into public.safety_bridge_settings(site_id,singleton,enabled,safety_tracker_url,updated_at,updated_by)
  values(v_site,true,coalesce(p_enabled,false),nullif(btrim(coalesce(p_safety_tracker_url,'')),''),now(),auth.uid())
  on conflict(site_id,singleton) do update set
    enabled=excluded.enabled,safety_tracker_url=excluded.safety_tracker_url,
    updated_at=excluded.updated_at,updated_by=excluded.updated_by;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_current_app_site_v21138(p_module_key text, p_site_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_module text:=lower(btrim(coalesce(p_module_key,'')));
  v_admin boolean:=false;
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if v_module not in ('inventory','energy') then raise exception 'Invalid app'; end if;
  if not exists(select 1 from public.organisation_sites_v21137 where id=p_site_id and active=true) then
    raise exception 'Site not found or inactive';
  end if;
  if not exists(select 1 from public.app_module_access where user_id=auth.uid() and module_key=v_module and enabled=true) then
    raise exception 'App access is not enabled';
  end if;

  select exists(
    select 1 from public.app_module_access a
    where a.user_id=auth.uid() and a.module_key=v_module and a.enabled=true
      and (coalesce(a.role_override,'')='admin' or 'admin'=any(coalesce(a.allowed_roles,'{}'::text[])))
  ) into v_admin;

  if not v_admin and not exists(
    select 1 from public.app_site_access_v21137
    where user_id=auth.uid() and module_key=v_module and site_id=p_site_id and enabled=true
  ) then
    raise exception 'You do not have access to this site';
  end if;

  insert into public.app_current_site_v21138(user_id,module_key,site_id,updated_at)
  values(auth.uid(),v_module,p_site_id,now())
  on conflict(user_id,module_key) do update
  set site_id=excluded.site_id,updated_at=now();

  return p_site_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_item_risk_rating(p_item_id uuid, p_rating text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  perform public.assess_item_risk(p_item_id,p_rating,p_reason);
end $function$;

CREATE OR REPLACE FUNCTION public.set_safety_bridge_enabled_v843(p_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid:=public.current_app_site_v21138('inventory');
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_inventory_admin_v836() then raise exception 'Admin access required'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  insert into public.safety_bridge_settings(site_id,singleton,enabled,safety_tracker_url,updated_at,updated_by)
  values(v_site,true,coalesce(p_enabled,false),'https://grich295.github.io/Safety-tracker/',now(),auth.uid())
  on conflict(site_id,singleton) do update set
    enabled=excluded.enabled,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  return coalesce(p_enabled,false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_safety_bridge_item_link_active_v836(p_link_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_site uuid:=public.current_app_site_v21138('inventory');
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if public.current_app_site_v21138('inventory') is null then raise exception 'Inventory app and site access required'; end if;
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_inventory_admin_v836() then raise exception 'Admin access required'; end if;
  update public.safety_bridge_item_links
  set active=coalesce(p_active,false)
  where id=p_link_id and site_id=v_site;
  if not found then raise exception 'Safety link not found at this site'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_app_access_v21137(p_user_id uuid, p_module_key text, p_enabled boolean, p_role text, p_preferred_view text DEFAULT NULL::text, p_home_site_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_module text:=lower(btrim(coalesce(p_module_key,'')));
  v_role text:=lower(btrim(coalesce(p_role,'')));
  v_view text:=lower(btrim(coalesce(p_preferred_view,'')));
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if v_module not in ('inventory','energy') then raise exception 'Invalid app'; end if;
  if v_role='' then v_role:='user'; end if;
  if not exists(select 1 from public.app_role_defaults_v21137 where module_key=v_module and role_key=v_role and active=true) then
    raise exception 'Invalid role for this app';
  end if;
  if v_view='' then
    select default_view into v_view from public.app_role_defaults_v21137 where module_key=v_module and role_key=v_role;
  end if;
  if v_view not in ('full','user','viewer','inputter') then raise exception 'Invalid working view'; end if;
  if p_home_site_id is not null and not exists(select 1 from public.organisation_sites_v21137 where id=p_home_site_id and active=true) then
    raise exception 'Invalid home site';
  end if;

  insert into public.app_module_access(user_id,module_key,enabled,role_override,allowed_roles,preferred_view,home_site_id,updated_at,updated_by,updated_reason)
  values(p_user_id,v_module,coalesce(p_enabled,false),v_role,array[v_role]::text[],v_view,p_home_site_id,now(),auth.uid(),'People & Access')
  on conflict(user_id,module_key) do update
    set enabled=excluded.enabled,
        role_override=excluded.role_override,
        allowed_roles=excluded.allowed_roles,
        preferred_view=excluded.preferred_view,
        home_site_id=excluded.home_site_id,
        updated_at=now(),
        updated_by=auth.uid(),
        updated_reason='People & Access';

  update public.app_site_access_v21137
  set is_home=false,updated_at=now(),updated_by=auth.uid()
  where user_id=p_user_id and module_key=v_module and is_home=true;

  if p_home_site_id is not null and coalesce(p_enabled,false) then
    insert into public.app_site_access_v21137(user_id,module_key,site_id,enabled,role_override,is_home,updated_at,updated_by)
    values(p_user_id,v_module,p_home_site_id,true,v_role,true,now(),auth.uid())
    on conflict(user_id,module_key,site_id) do update
      set enabled=true,role_override=excluded.role_override,is_home=true,updated_at=now(),updated_by=auth.uid();
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_capability_v21137(p_user_id uuid, p_module_key text, p_capability_key text, p_enabled boolean, p_scope_type text DEFAULT 'APP'::text, p_scope_id text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_module text:=lower(btrim(coalesce(p_module_key,'')));
  v_cap text:=lower(btrim(coalesce(p_capability_key,'')));
  v_scope text:=upper(btrim(coalesce(p_scope_type,'APP')));
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if v_module not in ('inventory','energy') then raise exception 'Invalid app'; end if;
  if v_cap='' then raise exception 'Capability is required'; end if;
  if v_scope not in ('APP','SITE','DEPARTMENT') then raise exception 'Invalid capability scope'; end if;
  insert into public.app_user_capabilities_v21137(user_id,module_key,capability_key,scope_type,scope_id,enabled,updated_at,updated_by)
  values(p_user_id,v_module,v_cap,v_scope,coalesce(p_scope_id,''),coalesce(p_enabled,true),now(),auth.uid())
  on conflict(user_id,module_key,capability_key,scope_type,scope_id) do update
  set enabled=excluded.enabled,updated_at=now(),updated_by=auth.uid();
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_site_access_v21137(p_user_id uuid, p_module_key text, p_site_id uuid, p_enabled boolean, p_role_override text DEFAULT NULL::text, p_is_home boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_module text:=lower(btrim(coalesce(p_module_key,'')));
begin

  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception 'Active authorised user required'; end if;
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if v_module not in ('inventory','energy') then raise exception 'Invalid app'; end if;
  if not exists(select 1 from public.organisation_sites_v21137 where id=p_site_id and active=true) then raise exception 'Invalid site'; end if;
  if coalesce(p_is_home,false) then
    update public.app_site_access_v21137 set is_home=false,updated_at=now(),updated_by=auth.uid()
    where user_id=p_user_id and module_key=v_module and is_home=true;
  end if;
  insert into public.app_site_access_v21137(user_id,module_key,site_id,enabled,role_override,is_home,updated_at,updated_by)
  values(p_user_id,v_module,p_site_id,coalesce(p_enabled,true),nullif(lower(btrim(coalesce(p_role_override,''))),''),coalesce(p_is_home,false),now(),auth.uid())
  on conflict(user_id,module_key,site_id) do update
    set enabled=excluded.enabled,role_override=excluded.role_override,is_home=excluded.is_home,updated_at=now(),updated_by=auth.uid();

  if coalesce(p_is_home,false) then
    update public.app_module_access set home_site_id=p_site_id,updated_at=now(),updated_by=auth.uid()
    where user_id=p_user_id and module_key=v_module;
  end if;
end;
$function$;

drop policy "app_user_capabilities_v21137_admin" on public.app_user_capabilities_v21137;
drop policy "app_user_capabilities_v21137_read" on public.app_user_capabilities_v21137;
create policy app_user_capabilities_v21137_read_v874 on public.app_user_capabilities_v21137 for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true) and (user_id=(select auth.uid()) or (select public.is_admin())));
create policy app_user_capabilities_v21137_insert_v874 on public.app_user_capabilities_v21137 for insert to authenticated with check ((select public.is_admin()));
create policy app_user_capabilities_v21137_update_v874 on public.app_user_capabilities_v21137 for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy app_user_capabilities_v21137_delete_v874 on public.app_user_capabilities_v21137 for delete to authenticated using ((select public.is_admin()));
drop policy "energy_historic_monthly_select" on public.energy_historic_monthly;
drop policy "energy_historic_monthly_write" on public.energy_historic_monthly;
drop policy "energy_site_scope_v21138" on public.energy_historic_monthly;
create policy energy_historic_monthly_read_v874 on public.energy_historic_monthly for select to authenticated using (site_id=(select public.current_energy_site_v21138()) and public.energy_enabled());
create policy energy_historic_monthly_insert_v874 on public.energy_historic_monthly for insert to authenticated with check (site_id=(select public.current_energy_site_v21138()) and (select public.energy_is_admin()));
create policy energy_historic_monthly_update_v874 on public.energy_historic_monthly for update to authenticated using (site_id=(select public.current_energy_site_v21138()) and (select public.energy_is_admin())) with check (site_id=(select public.current_energy_site_v21138()) and (select public.energy_is_admin()));
create policy energy_historic_monthly_delete_v874 on public.energy_historic_monthly for delete to authenticated using (site_id=(select public.current_energy_site_v21138()) and (select public.energy_is_admin()));
drop policy "organisation_sites_v21137_admin" on public.organisation_sites_v21137;
drop policy "organisation_sites_v21137_read" on public.organisation_sites_v21137;
create policy organisation_sites_v21137_read_v874 on public.organisation_sites_v21137 for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true) and ((select public.is_admin()) or exists(select 1 from public.app_site_access_v21137 s join public.app_module_access a on a.user_id=s.user_id and a.module_key=s.module_key and a.enabled where s.user_id=(select auth.uid()) and s.site_id=organisation_sites_v21137.id and s.enabled)));
create policy organisation_sites_v21137_insert_v874 on public.organisation_sites_v21137 for insert to authenticated with check ((select public.is_admin()));
create policy organisation_sites_v21137_update_v874 on public.organisation_sites_v21137 for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy organisation_sites_v21137_delete_v874 on public.organisation_sites_v21137 for delete to authenticated using ((select public.is_admin()));
drop policy "inventory_site_scope_v21138" on public.safety_acknowledgements;
drop policy "safety_ack_insert" on public.safety_acknowledgements;
drop policy "safety_ack_read" on public.safety_acknowledgements;
create policy safety_acknowledgements_read_v874 on public.safety_acknowledgements for select to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (user_id=(select auth.uid()) or (select public.is_inventory_admin_v836())));
create policy safety_acknowledgements_insert_v874 on public.safety_acknowledgements for insert to authenticated with check (site_id=(select public.current_app_site_v21138('inventory')) and user_id=(select auth.uid()));
drop policy "docs_read" on public.safety_documents;
drop policy "docs_write" on public.safety_documents;
drop policy "inventory_site_scope_v21138" on public.safety_documents;
create policy safety_documents_read_v874 on public.safety_documents for select to authenticated using (site_id=(select public.current_app_site_v21138('inventory')));
create policy safety_documents_insert_v874 on public.safety_documents for insert to authenticated with check (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_manager_or_admin()));
create policy safety_documents_update_v874 on public.safety_documents for update to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_manager_or_admin())) with check (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_manager_or_admin()));
create policy safety_documents_delete_v874 on public.safety_documents for delete to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_manager_or_admin()));
drop policy "inventory_site_scope_v21138" on public.safety_group_acknowledgements;
drop policy "safety_group_ack_insert" on public.safety_group_acknowledgements;
drop policy "safety_group_ack_read" on public.safety_group_acknowledgements;
create policy safety_group_acknowledgements_read_v874 on public.safety_group_acknowledgements for select to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (user_id=(select auth.uid()) or (select public.is_inventory_admin_v836())));
create policy safety_group_acknowledgements_insert_v874 on public.safety_group_acknowledgements for insert to authenticated with check (site_id=(select public.current_app_site_v21138('inventory')) and user_id=(select auth.uid()));
drop policy "inventory_site_scope_v21138" on public.safety_group_documents;
drop policy "safety_group_documents_admin" on public.safety_group_documents;
drop policy "safety_group_documents_read" on public.safety_group_documents;
create policy safety_group_documents_read_v874 on public.safety_group_documents for select to authenticated using (site_id=(select public.current_app_site_v21138('inventory')));
create policy safety_group_documents_insert_v874 on public.safety_group_documents for insert to authenticated with check (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
create policy safety_group_documents_update_v874 on public.safety_group_documents for update to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836())) with check (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
create policy safety_group_documents_delete_v874 on public.safety_group_documents for delete to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
drop policy "inventory_site_scope_v21138" on public.safety_group_items;
drop policy "safety_group_items_admin" on public.safety_group_items;
drop policy "safety_group_items_read" on public.safety_group_items;
create policy safety_group_items_read_v874 on public.safety_group_items for select to authenticated using (site_id=(select public.current_app_site_v21138('inventory')));
create policy safety_group_items_insert_v874 on public.safety_group_items for insert to authenticated with check (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
create policy safety_group_items_update_v874 on public.safety_group_items for update to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836())) with check (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
create policy safety_group_items_delete_v874 on public.safety_group_items for delete to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
drop policy "inventory_site_scope_v21138" on public.safety_groups;
drop policy "safety_groups_admin" on public.safety_groups;
drop policy "safety_groups_read" on public.safety_groups;
create policy safety_groups_read_v874 on public.safety_groups for select to authenticated using (site_id=(select public.current_app_site_v21138('inventory')));
create policy safety_groups_insert_v874 on public.safety_groups for insert to authenticated with check (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
create policy safety_groups_update_v874 on public.safety_groups for update to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836())) with check (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
create policy safety_groups_delete_v874 on public.safety_groups for delete to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
drop policy "inventory_site_scope_v21138" on public.safety_settings;
drop policy "safety_settings_admin" on public.safety_settings;
drop policy "safety_settings_read" on public.safety_settings;
create policy safety_settings_read_v874 on public.safety_settings for select to authenticated using (site_id=(select public.current_app_site_v21138('inventory')));
create policy safety_settings_insert_v874 on public.safety_settings for insert to authenticated with check (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
create policy safety_settings_update_v874 on public.safety_settings for update to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836())) with check (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
create policy safety_settings_delete_v874 on public.safety_settings for delete to authenticated using (site_id=(select public.current_app_site_v21138('inventory')) and (select public.is_inventory_admin_v836()));
drop policy "site_module_status_v21138_admin" on public.site_module_status_v21138;
drop policy "site_module_status_v21138_read" on public.site_module_status_v21138;
create policy site_module_status_v21138_read_v874 on public.site_module_status_v21138 for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true) and ((select public.is_admin()) or exists(select 1 from public.app_site_access_v21137 s join public.app_module_access a on a.user_id=s.user_id and a.module_key=s.module_key and a.enabled where s.user_id=(select auth.uid()) and s.site_id=site_module_status_v21138.site_id and s.module_key=site_module_status_v21138.module_key and s.enabled)));
create policy site_module_status_v21138_insert_v874 on public.site_module_status_v21138 for insert to authenticated with check ((select public.is_admin()));
create policy site_module_status_v21138_update_v874 on public.site_module_status_v21138 for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy site_module_status_v21138_delete_v874 on public.site_module_status_v21138 for delete to authenticated using ((select public.is_admin()));
-- Missing FK indexes reported by the advisor (existing useful indexes retained).
do $indexes$
declare r record; cols text;
begin
for r in select c.conrelid,c.conname,c.conkey,c.conrelid::regclass as tbl from pg_constraint c join pg_namespace n on n.oid=c.connamespace where c.contype='f' and n.nspname='public' and c.conname in ('energy_alerts_assigned_to_fkey','energy_alerts_meter_id_fkey','energy_alerts_site_id_fkey','energy_audit_log_site_id_fkey','energy_audit_log_user_id_fkey','energy_budgets_source_future_budget_plan_id_fkey','energy_business_forecast_source_document_id_fkey','energy_chiller_settings_history_meter_id_fkey','energy_chp_breakdown_events_created_by_fkey','energy_documents_site_id_fkey','energy_documents_uploaded_by_fkey','energy_generation_source_document_id_fkey','energy_half_hour_reads_meter_id_fkey','energy_historic_monthly_meter_id_fkey','energy_invoices_meter_id_fkey','energy_invoices_source_document_id_fkey','energy_meter_conversion_history_site_id_fkey','energy_meter_reads_reconciliation_invoice_id_fkey','energy_meter_reads_site_id_fkey','energy_meter_reads_source_document_id_fkey','energy_meters_parent_meter_id_fkey','energy_meters_site_id_fkey','energy_occupancy_source_document_id_fkey','energy_solar_inverter_interval_reads_batch_id_fkey','energy_tariffs_site_id_fkey','energy_utility_vat_rates_created_by_fkey','risk_rating_history_changed_by_fkey','risk_rating_history_item_id_fkey','safety_acknowledgements_item_id_fkey','safety_acknowledgements_user_id_fkey','safety_documents_item_id_fkey','safety_documents_uploaded_by_fkey','safety_group_acknowledgements_group_id_fkey','safety_group_acknowledgements_user_id_fkey','safety_group_documents_group_id_fkey','safety_group_documents_uploaded_by_fkey','safety_group_items_group_id_fkey','safety_group_items_linked_by_fkey','safety_groups_created_by_fkey','safety_settings_updated_by_fkey')
loop
select string_agg(quote_ident(a.attname),',' order by k.ord) into cols from unnest(r.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=r.conrelid and a.attnum=k.attnum;
execute format('create index if not exists %I on %s (%s)',left(r.conname,54)||'_v874_idx',r.tbl,cols);
end loop;
end $indexes$;
notify pgrst,'reload schema';
