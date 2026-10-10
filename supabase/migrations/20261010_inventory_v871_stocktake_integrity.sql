-- Inventory Tracker v8.7.1
-- Applied to live Supabase project on 2026-10-10.

create index if not exists transactions_site_occurred_v870_idx
  on public.transactions(site_id, occurred_at desc);

create index if not exists stocktake_tasks_site_status_due_v870_idx
  on public.stocktake_tasks(site_id, status, due_at);

create or replace function public.complete_stocktake_task_v870(
  p_task_id uuid,
  p_counts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_site is null then raise exception 'No Inventory site selected'; end if;
  if jsonb_typeof(p_counts) is distinct from 'array' then
    raise exception 'Stocktake counts are missing or invalid';
  end if;

  select assigned_user_id,status
    into v_assigned,v_status
  from public.stocktake_tasks
  where id=p_task_id and site_id=v_site
  for update;

  if not found then raise exception 'Stocktake task not found at this site'; end if;
  if v_status not in ('OPEN','OVERDUE') then raise exception 'This stocktake is no longer open'; end if;
  if v_assigned<>auth.uid() and not public.is_inventory_admin_v836() then
    raise exception 'This stocktake is assigned to another user';
  end if;

  select count(*) into v_expected_lines
  from public.stocktake_task_items
  where task_id=p_task_id and site_id=v_site and completed_at is null;

  select count(*) into v_payload_lines from jsonb_array_elements(p_counts);

  if v_expected_lines=0 then raise exception 'This stocktake has no open lines'; end if;
  if v_payload_lines<>v_expected_lines then raise exception 'Enter a counted quantity for every stocktake item'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_counts) x
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
    select sti.id,sti.item_id,sti.location_id,sti.expected_quantity,
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
  set status='COMPLETED',completed_at=v_now,completed_by=auth.uid()
  where id=p_task_id and site_id=v_site and status in ('OPEN','OVERDUE');

  return jsonb_build_object(
    'task_id',p_task_id,
    'completed_at',v_now,
    'lines',v_expected_lines,
    'adjustments',v_adjusted
  );
end;
$$;

revoke all on function public.complete_stocktake_task_v870(uuid,jsonb) from public;
revoke all on function public.complete_stocktake_task_v870(uuid,jsonb) from anon;
grant execute on function public.complete_stocktake_task_v870(uuid,jsonb) to authenticated;
