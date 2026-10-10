CREATE OR REPLACE FUNCTION public.inventory_push_candidates_v872()
 RETURNS TABLE(subscription_id uuid, endpoint text, p256dh text, auth text, event_key text, event_hash text, title text, body text, severity text, target_url text, source_alert_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        where sa.user_id=s.user_id
          and sa.module_key='inventory'
          and sa.site_id=s.site_id
          and sa.enabled=true
      )
    )
),
stock_totals as (
  select i.site_id,i.id item_id,i.name,i.reorder_level,
         coalesce(sum(b.quantity),0) quantity
  from public.items i
  left join public.stock_balances b
    on b.item_id=i.id and b.site_id=i.site_id
  where i.active=true and coalesce(i.reorder_level,0)>0
  group by i.site_id,i.id,i.name,i.reorder_level
),
low_stock as (
  select site_id,
         count(*) item_count,
         string_agg(name,', ' order by name) names,
         jsonb_agg(item_id::text order by item_id)::text state_hash
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
         'LOW_STOCK:'||s.id::text event_key,coalesce(l.state_hash,'[]') event_hash,
         'Inventory · low stock' title,
         coalesce(l.item_count,0)||' item'||case when l.item_count=1 then '' else 's' end||
           ' at/below reorder level · '||
           coalesce(l.names,'None') body,
         'WARN' severity,'./?page=orders' target_url,null::uuid source_alert_id
  from subs s left join low_stock l on l.site_id=s.site_id
  where s.effective_role in ('admin','manager')

  union all

  select s.id,s.endpoint,s.p256dh,s.auth,
         'OVERDUE_ORDERS:'||s.id::text,o.state_hash,
         'Inventory · overdue order'||
           case when o.order_count=1 then '' else 's' end,
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
           ' · '||
           case when length(w.titles)>120 then left(w.titles,117)||'…' else w.titles end,
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
  join public.stocktake_tasks t
    on t.assigned_user_id=s.user_id and t.site_id=s.site_id
  where t.status in ('OPEN','OVERDUE') and t.due_at<now()
),
client_candidates as (
  select s.id,s.endpoint,s.p256dh,s.auth,
         'CLIENT_ALERT:'||s.id::text||':'||a.id::text,
         md5(a.alert_type||':'||a.message||':'||a.updated_at::text),
         case when a.alert_type='OFFLINE_SYNC_FAILED'
              then 'Inventory · sync needs attention'
              else 'Inventory · app alert' end,
         a.message,
         'WARN','./',a.id
  from subs s
  join public.inventory_client_alerts a
    on a.user_id=s.user_id and a.site_id=s.site_id
  where a.status='OPEN'
)
select * from manager_candidates
union all select * from stocktake_candidates
union all select * from client_candidates;
$function$
;
-- Baseline the existing low list without sending another notification.
insert into public.inventory_push_event_state(event_key,event_hash,last_sent_at,updated_at) select event_key,event_hash,now(),now() from public.inventory_push_candidates_v872() where event_key like 'LOW_STOCK:%' on conflict(event_key) do update set event_hash=excluded.event_hash,updated_at=now();
