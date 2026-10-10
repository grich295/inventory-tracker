-- Inventory Tracker v8.7.2
-- Applied live: 2026-10-10
-- Hourly integrity watchdog.

create table if not exists public.inventory_watchdog_issues (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.organisation_sites_v21137(id) on delete cascade,
  issue_key text not null,
  category text not null,
  severity text not null check (severity in ('INFO','WARN','CRITICAL')),
  title text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  detected_count integer not null default 1,
  unique(site_id,issue_key)
);

alter table public.inventory_watchdog_issues enable row level security;

drop policy if exists inventory_watchdog_read_v872 on public.inventory_watchdog_issues;
create policy inventory_watchdog_read_v872
on public.inventory_watchdog_issues
for select to authenticated
using (
  site_id=public.current_app_site_v21138('inventory')
  and public.is_manager_or_admin()
);

create index if not exists inventory_watchdog_open_v872_idx
  on public.inventory_watchdog_issues(site_id,status,severity,last_seen_at desc);

create or replace function public.run_inventory_watchdog_v872()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_open integer;
begin
  create temporary table inventory_watchdog_scan_v872 (
    site_id uuid not null,
    issue_key text not null,
    category text not null,
    severity text not null,
    title text not null,
    details jsonb not null
  ) on commit drop;

  insert into inventory_watchdog_scan_v872
  select b.site_id,'BALANCE_NEGATIVE:'||b.item_id||':'||b.location_id,
         'STOCK','CRITICAL','Negative stock balance',
         jsonb_build_object('item_id',b.item_id,'location_id',b.location_id,'quantity',b.quantity)
  from public.stock_balances b where b.quantity<0;

  insert into inventory_watchdog_scan_v872
  select b.site_id,'BALANCE_ITEM_SITE:'||b.item_id||':'||b.location_id,
         'SITE_SCOPE','CRITICAL','Stock balance item belongs to a different site',
         jsonb_build_object('item_id',b.item_id,'balance_site_id',b.site_id,'item_site_id',i.site_id)
  from public.stock_balances b join public.items i on i.id=b.item_id
  where i.site_id is distinct from b.site_id;

  insert into inventory_watchdog_scan_v872
  select b.site_id,'BALANCE_LOCATION_SITE:'||b.item_id||':'||b.location_id,
         'SITE_SCOPE','CRITICAL','Stock balance location belongs to a different site',
         jsonb_build_object('item_id',b.item_id,'location_id',b.location_id,'balance_site_id',b.site_id,'location_site_id',l.site_id)
  from public.stock_balances b join public.stock_locations l on l.id=b.location_id
  where l.site_id is distinct from b.site_id;

  insert into inventory_watchdog_scan_v872
  select t.site_id,'TX_ITEM_SITE:'||t.id,'SITE_SCOPE','CRITICAL',
         'Transaction item belongs to a different site',
         jsonb_build_object('transaction_id',t.id,'item_id',t.item_id,'transaction_site_id',t.site_id,'item_site_id',i.site_id)
  from public.transactions t join public.items i on i.id=t.item_id
  where i.site_id is distinct from t.site_id;

  insert into inventory_watchdog_scan_v872
  select t.site_id,'TX_FROM_SITE:'||t.id,'SITE_SCOPE','CRITICAL',
         'Transaction source location belongs to a different site',
         jsonb_build_object('transaction_id',t.id,'location_id',t.from_location_id,'transaction_site_id',t.site_id,'location_site_id',l.site_id)
  from public.transactions t join public.stock_locations l on l.id=t.from_location_id
  where t.from_location_id is not null and l.site_id is distinct from t.site_id;

  insert into inventory_watchdog_scan_v872
  select t.site_id,'TX_TO_SITE:'||t.id,'SITE_SCOPE','CRITICAL',
         'Transaction destination location belongs to a different site',
         jsonb_build_object('transaction_id',t.id,'location_id',t.to_location_id,'transaction_site_id',t.site_id,'location_site_id',l.site_id)
  from public.transactions t join public.stock_locations l on l.id=t.to_location_id
  where t.to_location_id is not null and l.site_id is distinct from t.site_id;

  insert into inventory_watchdog_scan_v872
  select i.site_id,'ITEM_DEFAULT_SITE:'||i.id,'ITEM','WARN',
         'Item default location belongs to a different site',
         jsonb_build_object('item_id',i.id,'default_location_id',i.default_location_id,'item_site_id',i.site_id,'location_site_id',l.site_id)
  from public.items i join public.stock_locations l on l.id=i.default_location_id
  where i.default_location_id is not null and l.site_id is distinct from i.site_id;

  insert into inventory_watchdog_scan_v872
  select i.site_id,'ITEM_DEFAULT_INACTIVE:'||i.id,'ITEM','WARN',
         'Item default location is inactive',
         jsonb_build_object('item_id',i.id,'default_location_id',i.default_location_id)
  from public.items i join public.stock_locations l on l.id=i.default_location_id
  where i.active=true and i.default_location_id is not null and l.active=false;

  insert into inventory_watchdog_scan_v872
  select i.site_id,'ITEM_PARENT_SITE:'||i.id,'ITEM','CRITICAL',
         'Linked item variant parent belongs to a different site',
         jsonb_build_object('item_id',i.id,'parent_item_id',i.parent_item_id,'item_site_id',i.site_id,'parent_site_id',p.site_id)
  from public.items i join public.items p on p.id=i.parent_item_id
  where i.parent_item_id is not null and p.site_id is distinct from i.site_id;

  insert into inventory_watchdog_scan_v872
  select p.site_id,'PO_QTY:'||p.id,'ORDER','CRITICAL',
         'Purchase order has an impossible quantity',
         jsonb_build_object('order_id',p.id,'quantity_ordered',p.quantity_ordered,'quantity_received',p.quantity_received)
  from public.purchase_orders p
  where p.quantity_ordered<=0 or p.quantity_received<0 or p.quantity_received>p.quantity_ordered;

  insert into inventory_watchdog_scan_v872
  select p.site_id,'PO_ITEM_SITE:'||p.id,'SITE_SCOPE','CRITICAL',
         'Purchase order item belongs to a different site',
         jsonb_build_object('order_id',p.id,'item_id',p.item_id,'order_site_id',p.site_id,'item_site_id',i.site_id)
  from public.purchase_orders p join public.items i on i.id=p.item_id
  where i.site_id is distinct from p.site_id;

  insert into inventory_watchdog_scan_v872
  select s.site_id,'SUPPLIER_ITEM_SITE:'||s.id,'SITE_SCOPE','WARN',
         'Supplier link item belongs to a different site',
         jsonb_build_object('supplier_link_id',s.id,'item_id',s.item_id,'supplier_site_id',s.site_id,'item_site_id',i.site_id)
  from public.item_suppliers s join public.items i on i.id=s.item_id
  where i.site_id is distinct from s.site_id;

  insert into inventory_watchdog_scan_v872
  select x.site_id,'STOCKTAKE_TASK_SITE:'||x.id,'SITE_SCOPE','CRITICAL',
         'Stocktake line and task belong to different sites',
         jsonb_build_object('stocktake_item_id',x.id,'task_id',x.task_id,'line_site_id',x.site_id,'task_site_id',t.site_id)
  from public.stocktake_task_items x join public.stocktake_tasks t on t.id=x.task_id
  where t.site_id is distinct from x.site_id;

  insert into inventory_watchdog_scan_v872
  select x.site_id,'STOCKTAKE_ITEM_SITE:'||x.id,'SITE_SCOPE','CRITICAL',
         'Stocktake item belongs to a different site',
         jsonb_build_object('stocktake_item_id',x.id,'item_id',x.item_id,'line_site_id',x.site_id,'item_site_id',i.site_id)
  from public.stocktake_task_items x join public.items i on i.id=x.item_id
  where i.site_id is distinct from x.site_id;

  insert into inventory_watchdog_scan_v872
  select x.site_id,'STOCKTAKE_LOCATION_SITE:'||x.id,'SITE_SCOPE','CRITICAL',
         'Stocktake location belongs to a different site',
         jsonb_build_object('stocktake_item_id',x.id,'location_id',x.location_id,'line_site_id',x.site_id,'location_site_id',l.site_id)
  from public.stocktake_task_items x join public.stock_locations l on l.id=x.location_id
  where l.site_id is distinct from x.site_id;

  insert into inventory_watchdog_scan_v872
  select t.site_id,'STOCKTAKE_COMPLETED_OPEN_LINES:'||t.id,'STOCKTAKE','CRITICAL',
         'Completed stocktake still has incomplete lines',
         jsonb_build_object('task_id',t.id,'incomplete_lines',
           (select count(*) from public.stocktake_task_items x where x.task_id=t.id and x.completed_at is null))
  from public.stocktake_tasks t
  where t.status='COMPLETED'
    and exists(select 1 from public.stocktake_task_items x where x.task_id=t.id and x.completed_at is null);

  insert into inventory_watchdog_scan_v872
  select t.site_id,'STOCKTAKE_OPEN_COMPLETED_LINES:'||t.id,'STOCKTAKE','WARN',
         'Open stocktake already contains completed lines',
         jsonb_build_object('task_id',t.id,'completed_lines',
           (select count(*) from public.stocktake_task_items x where x.task_id=t.id and x.completed_at is not null))
  from public.stocktake_tasks t
  where t.status in ('OPEN','OVERDUE')
    and exists(select 1 from public.stocktake_task_items x where x.task_id=t.id and x.completed_at is not null);

  insert into inventory_watchdog_scan_v872
  select p.site_id,'PREF_ITEM_SITE:'||p.user_id||':'||p.item_id,'SITE_SCOPE','WARN',
         'User preference references an item on another site',
         jsonb_build_object('user_id',p.user_id,'item_id',p.item_id,'preference_site_id',p.site_id,'item_site_id',i.site_id)
  from public.user_item_preferences p join public.items i on i.id=p.item_id
  where i.site_id is distinct from p.site_id;

  insert into inventory_watchdog_scan_v872
  select l.site_id,'SAFETY_LINK_ITEM_SITE:'||l.id,'SITE_SCOPE','WARN',
         'Safety Bridge link references an item on another site',
         jsonb_build_object('link_id',l.id,'item_id',l.item_id,'link_site_id',l.site_id,'item_site_id',i.site_id)
  from public.safety_bridge_item_links l join public.items i on i.id=l.item_id
  where i.site_id is distinct from l.site_id;

  insert into inventory_watchdog_scan_v872
  select d.site_id,'DUP_LOCATION:'||md5(d.location_key),'LOCATION','WARN',
         'Duplicate stock location/bin after normalizing spacing or case',
         jsonb_build_object('normalized_location',d.location_key,'rows',d.row_count)
  from (
    select site_id,
           lower(btrim(location_name))||'|'||
           lower(btrim(coalesce(area_name,'')))||'|'||
           lower(btrim(coalesce(bin_code,''))) as location_key,
           count(*) row_count
    from public.stock_locations
    where active=true
    group by site_id,2
    having count(*)>1
  ) d;

  insert into public.inventory_watchdog_issues(
    site_id,issue_key,category,severity,title,details,status,
    first_seen_at,last_seen_at,resolved_at,detected_count
  )
  select site_id,issue_key,category,severity,title,details,'OPEN',now(),now(),null,1
  from inventory_watchdog_scan_v872
  on conflict(site_id,issue_key) do update
    set category=excluded.category,
        severity=excluded.severity,
        title=excluded.title,
        details=excluded.details,
        status='OPEN',
        last_seen_at=now(),
        resolved_at=null,
        detected_count=public.inventory_watchdog_issues.detected_count+1;

  update public.inventory_watchdog_issues w
  set status='RESOLVED',resolved_at=now()
  where w.status='OPEN'
    and not exists(
      select 1 from inventory_watchdog_scan_v872 s
      where s.site_id=w.site_id and s.issue_key=w.issue_key
    );

  select count(*) into v_open from public.inventory_watchdog_issues where status='OPEN';
  return v_open;
end;
$$;

revoke all on function public.run_inventory_watchdog_v872() from public, anon, authenticated;
grant execute on function public.run_inventory_watchdog_v872() to service_role;

create or replace function public.inventory_watchdog_summary_v872()
returns table(
  id uuid,severity text,category text,title text,details jsonb,
  first_seen_at timestamptz,last_seen_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_manager_or_admin() then raise exception 'Manager or Admin access required'; end if;
  return query
  select w.id,w.severity,w.category,w.title,w.details,w.first_seen_at,w.last_seen_at
  from public.inventory_watchdog_issues w
  where w.site_id=v_site and w.status='OPEN'
  order by case w.severity when 'CRITICAL' then 0 when 'WARN' then 1 else 2 end,
           w.last_seen_at desc;
end;
$$;

revoke all on function public.inventory_watchdog_summary_v872() from public, anon;
grant execute on function public.inventory_watchdog_summary_v872() to authenticated, service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname='inventory-watchdog-v872'
  loop perform cron.unschedule(v_job.jobid); end loop;
  perform cron.schedule(
    'inventory-watchdog-v872',
    '17 * * * *',
    'select public.run_inventory_watchdog_v872();'
  );
end $$;
