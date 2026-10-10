-- Inventory Tracker v8.7.2
-- Applied live: 2026-10-10
-- Web Push infrastructure. Runtime secrets/VAPID private key are generated
-- inside Supabase and are never stored in GitHub.

create table if not exists public.inventory_push_runtime_config (
  singleton boolean primary key default true check (singleton=true),
  enabled boolean not null default true,
  scheduler_secret text not null default encode(extensions.gen_random_bytes(24),'hex'),
  vapid_public_key text,
  vapid_private_key text,
  updated_at timestamptz not null default now()
);

insert into public.inventory_push_runtime_config(singleton)
values(true)
on conflict(singleton) do nothing;

alter table public.inventory_push_runtime_config enable row level security;
revoke all on public.inventory_push_runtime_config from anon, authenticated;

create table if not exists public.inventory_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  site_id uuid not null references public.organisation_sites_v21137(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text
);

alter table public.inventory_push_subscriptions enable row level security;

drop policy if exists inventory_push_subscriptions_self_v872 on public.inventory_push_subscriptions;
create policy inventory_push_subscriptions_self_v872
on public.inventory_push_subscriptions
for select to authenticated
using (
  user_id=(select auth.uid())
  and site_id=public.current_app_site_v21138('inventory')
);

create index if not exists inventory_push_subscriptions_user_site_v872_idx
  on public.inventory_push_subscriptions(user_id,site_id)
  where enabled=true;

create table if not exists public.inventory_push_event_state (
  event_key text primary key,
  event_hash text not null,
  last_sent_at timestamptz not null default now(),
  send_count integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.inventory_push_event_state enable row level security;
revoke all on public.inventory_push_event_state from anon, authenticated;

create table if not exists public.inventory_client_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  site_id uuid not null references public.organisation_sites_v21137(id) on delete cascade,
  alert_type text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN' check(status in ('OPEN','SENT','RESOLVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_client_alerts enable row level security;
revoke all on public.inventory_client_alerts from anon, authenticated;

create index if not exists inventory_client_alerts_open_v872_idx
  on public.inventory_client_alerts(user_id,site_id,status,created_at desc);

create or replace function public.get_inventory_push_public_key_v872()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_key text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select vapid_public_key into v_key
  from public.inventory_push_runtime_config
  where singleton=true and enabled=true;
  return v_key;
end;
$$;

revoke all on function public.get_inventory_push_public_key_v872() from public, anon;
grant execute on function public.get_inventory_push_public_key_v872() to authenticated, service_role;

create or replace function public.save_inventory_push_subscription_v872(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
  v_id uuid;
begin
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
$$;

revoke all on function public.save_inventory_push_subscription_v872(text,text,text,text) from public, anon;
grant execute on function public.save_inventory_push_subscription_v872(text,text,text,text) to authenticated, service_role;

create or replace function public.delete_inventory_push_subscription_v872(p_endpoint text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from public.inventory_push_subscriptions
  where endpoint=p_endpoint and user_id=auth.uid();
end;
$$;

revoke all on function public.delete_inventory_push_subscription_v872(text) from public, anon;
grant execute on function public.delete_inventory_push_subscription_v872(text) to authenticated, service_role;

create or replace function public.record_inventory_client_alert_v872(
  p_alert_type text,
  p_message text,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
  v_id uuid;
  v_type text:=upper(btrim(coalesce(p_alert_type,'')));
begin
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

  insert into public.inventory_client_alerts(user_id,site_id,alert_type,message,details)
  values(auth.uid(),v_site,v_type,btrim(p_message),coalesce(p_details,'{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_inventory_client_alert_v872(text,text,jsonb) from public, anon;
grant execute on function public.record_inventory_client_alert_v872(text,text,jsonb) to authenticated, service_role;

create or replace function public.resolve_inventory_client_alert_v872(p_alert_type text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_site uuid:=public.current_app_site_v21138('inventory');
  v_count integer;
begin
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
$$;

revoke all on function public.resolve_inventory_client_alert_v872(text) from public, anon;
grant execute on function public.resolve_inventory_client_alert_v872(text) to authenticated, service_role;

create or replace function public.inventory_push_runtime_v872()
returns table(
  enabled boolean,
  scheduler_secret text,
  vapid_public_key text,
  vapid_private_key text
)
language sql
security definer
set search_path to 'public'
as $$
  select c.enabled,c.scheduler_secret,c.vapid_public_key,c.vapid_private_key
  from public.inventory_push_runtime_config c
  where c.singleton=true
$$;

revoke all on function public.inventory_push_runtime_v872() from public, anon, authenticated;
grant execute on function public.inventory_push_runtime_v872() to service_role;

create or replace function public.inventory_push_candidates_v872()
returns table(
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  event_key text,
  event_hash text,
  title text,
  body text,
  severity text,
  target_url text,
  source_alert_id uuid
)
language sql
security definer
set search_path to 'public'
as $$
with subs as (
  select s.id,s.user_id,s.site_id,s.endpoint,s.p256dh,s.auth,
         coalesce(a.role_override,
           case when p.role::text='staff' then 'user' else p.role::text end
         ) effective_role
  from public.inventory_push_subscriptions s
  join public.profiles p on p.id=s.user_id and p.active is distinct from false
  join public.app_module_access a
    on a.user_id=s.user_id and a.module_key='inventory' and a.enabled=true
  where s.enabled=true
    and (
      coalesce(a.role_override,'')='admin'
      or p.role::text='admin'
      or exists(
        select 1 from public.app_site_access_v21137 sa
        where sa.user_id=s.user_id and sa.module_key='inventory'
          and sa.site_id=s.site_id and sa.enabled=true
      )
    )
),
stock_totals as (
  select i.site_id,i.id item_id,i.name,i.reorder_level,
         coalesce(sum(b.quantity),0) quantity
  from public.items i
  left join public.stock_balances b on b.item_id=i.id and b.site_id=i.site_id
  where i.active=true and coalesce(i.reorder_level,0)>0
  group by i.site_id,i.id,i.name,i.reorder_level
),
low_stock as (
  select site_id,count(*) item_count,
         string_agg(name,', ' order by name) names,
         md5(string_agg(item_id::text||':'||quantity::text||':'||reorder_level::text,'|' order by item_id)) state_hash
  from stock_totals
  where quantity<=reorder_level
  group by site_id
),
overdue_orders as (
  select p.site_id,count(*) order_count,
         string_agg(i.name,', ' order by i.name) names,
         md5(string_agg(p.id::text||':'||(p.quantity_ordered-p.quantity_received)::text||':'||coalesce(p.expected_date::text,''),'|' order by p.id)) state_hash
  from public.purchase_orders p
  join public.items i on i.id=p.item_id and i.site_id=p.site_id
  where p.status in ('OPEN','PART_RECEIVED')
    and p.expected_date is not null
    and p.expected_date<current_date
    and p.quantity_received<p.quantity_ordered
  group by p.site_id
),
watchdog as (
  select w.site_id,count(*) issue_count,
         bool_or(w.severity='CRITICAL') critical,
         string_agg(w.title,', ' order by w.title) titles,
         md5(string_agg(w.issue_key||':'||w.severity||':'||w.details::text,'|' order by w.issue_key)) state_hash
  from public.inventory_watchdog_issues w
  where w.status='OPEN'
  group by w.site_id
),
manager_candidates as (
  select s.id subscription_id,s.endpoint,s.p256dh,s.auth,
         'LOW_STOCK:'||s.id::text event_key,l.state_hash event_hash,
         'Inventory · low stock' title,
         l.item_count||' item'||case when l.item_count=1 then '' else 's' end||
           ' at/below reorder level · '||
           case when length(l.names)>120 then left(l.names,117)||'…' else l.names end body,
         'WARN' severity,'./?page=orders' target_url,null::uuid source_alert_id
  from subs s join low_stock l on l.site_id=s.site_id
  where s.effective_role in ('admin','manager')

  union all

  select s.id,s.endpoint,s.p256dh,s.auth,
         'OVERDUE_ORDERS:'||s.id::text,o.state_hash,
         'Inventory · overdue order'||case when o.order_count=1 then '' else 's' end,
         o.order_count||' open order'||case when o.order_count=1 then '' else 's' end||
           ' past expected date · '||
           case when length(o.names)>120 then left(o.names,117)||'…' else o.names end,
         'WARN','./?page=orders',null::uuid
  from subs s join overdue_orders o on o.site_id=s.site_id
  where s.effective_role in ('admin','manager')

  union all

  select s.id,s.endpoint,s.p256dh,s.auth,
         'WATCHDOG:'||s.id::text,w.state_hash,
         case when w.critical then 'Inventory · critical audit issue' else 'Inventory · audit warning' end,
         w.issue_count||' open integrity issue'||case when w.issue_count=1 then '' else 's' end||
           ' · '||case when length(w.titles)>120 then left(w.titles,117)||'…' else w.titles end,
         case when w.critical then 'CRITICAL' else 'WARN' end,
         './?page=reports',null::uuid
  from subs s join watchdog w on w.site_id=s.site_id
  where s.effective_role in ('admin','manager')
),
stocktake_candidates as (
  select s.id,s.endpoint,s.p256dh,s.auth,
         'STOCKTAKE:'||s.id::text||':'||t.id::text,
         md5(t.status||':'||t.due_at::text),
         'Inventory · stocktake overdue',
         'Your stocktake was due '||to_char(t.due_at at time zone 'Europe/London','DD Mon HH24:MI')||'. Tap to complete it.',
         'WARN','./?page=stocktake',null::uuid
  from subs s
  join public.stocktake_tasks t on t.assigned_user_id=s.user_id and t.site_id=s.site_id
  where t.status in ('OPEN','OVERDUE') and t.due_at<now()
),
client_candidates as (
  select s.id,s.endpoint,s.p256dh,s.auth,
         'CLIENT_ALERT:'||s.id::text||':'||a.id::text,
         md5(a.alert_type||':'||a.message||':'||a.updated_at::text),
         case when a.alert_type='OFFLINE_SYNC_FAILED'
              then 'Inventory · sync needs attention'
              else 'Inventory · app alert' end,
         a.message,'WARN','./',a.id
  from subs s
  join public.inventory_client_alerts a on a.user_id=s.user_id and a.site_id=s.site_id
  where a.status='OPEN'
)
select * from manager_candidates
union all select * from stocktake_candidates
union all select * from client_candidates;
$$;

revoke all on function public.inventory_push_candidates_v872() from public, anon, authenticated;
grant execute on function public.inventory_push_candidates_v872() to service_role;

create extension if not exists pg_net with schema extensions;

create or replace function public.dispatch_inventory_push_v872()
returns bigint
language plpgsql
security definer
set search_path to 'public','extensions'
as $$
declare
  v_secret text;
  v_enabled boolean;
  v_request_id bigint;
begin
  select enabled,scheduler_secret into v_enabled,v_secret
  from public.inventory_push_runtime_config
  where singleton=true;

  if not coalesce(v_enabled,false) or nullif(v_secret,'') is null then
    return null;
  end if;

  select net.http_post(
    url:='https://zgmcxgumdsssngfgtmth.supabase.co/functions/v1/inventory-alerts?key='||v_secret,
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:='{"scheduled":true}'::jsonb,
    timeout_milliseconds:=15000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.dispatch_inventory_push_v872() from public, anon, authenticated;
grant execute on function public.dispatch_inventory_push_v872() to service_role;

do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname='inventory-push-v872'
  loop perform cron.unschedule(v_job.jobid); end loop;
  perform cron.schedule(
    'inventory-push-v872',
    '23 * * * *',
    'select public.dispatch_inventory_push_v872();'
  );
end $$;
