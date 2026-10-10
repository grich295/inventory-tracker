-- Applied live 2026-10-10: authorised access only; Inventory demo removed.
revoke execute on function public.clean_site_counts_v21138(uuid), public.create_clean_site_v21138(text,text), public.current_energy_site_v21138(), public.energy_import_legacy_actuals(uuid,jsonb), public.energy_is_admin() from public, anon;
grant execute on function public.clean_site_counts_v21138(uuid), public.create_clean_site_v21138(text,text), public.current_energy_site_v21138(), public.energy_import_legacy_actuals(uuid,jsonb), public.energy_is_admin() to authenticated, service_role;
revoke execute on function public.sync_energy_permission_from_site_access_v21138() from public, anon, authenticated;
drop function if exists public.get_inventory_demo_config_v850();
do $migration$
declare def text;
begin
select pg_get_functiondef('public.energy_import_legacy_actuals(uuid,jsonb)'::regprocedure) into def;
def:=replace(def,'  if not public.energy_can_write() then', '  if auth.uid() is null or not public.energy_can_write() then');
def:=replace(def,'  for r in select value from jsonb_array_elements(p_rows)', '  if p_site_id is distinct from public.current_energy_site_v21138() then
    raise exception ''Selected Energy site access required'';
  end if;
  for r in select value from jsonb_array_elements(p_rows)');
execute def;
select pg_get_functiondef('public.clean_site_counts_v21138(uuid)'::regprocedure) into def;
def:=replace(def, '  if auth.uid() is null then raise exception ''Sign in required''; end if;', '  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active=true) then raise exception ''Active authorised user required''; end if;');
execute def;
end $migration$;
create schema if not exists extensions;
revoke create on schema extensions from public, anon, authenticated;
grant usage on schema extensions to authenticated, service_role;
alter extension citext set schema extensions;
notify pgrst,'reload schema';
