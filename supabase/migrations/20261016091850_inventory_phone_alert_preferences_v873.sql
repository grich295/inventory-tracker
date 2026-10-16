-- Per-device inventory phone alert categories, v8.7.15.
ALTER TABLE public.inventory_push_subscriptions
  ADD COLUMN IF NOT EXISTS alert_low_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alert_overdue_orders boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alert_watchdog boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alert_stocktake boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alert_sync_failure boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.get_inventory_push_preferences_v873(p_endpoint text)
RETURNS TABLE(enabled boolean, alert_low_stock boolean, alert_overdue_orders boolean,
              alert_watchdog boolean, alert_stocktake boolean, alert_sync_failure boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_site uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.active=true
  ) THEN RAISE EXCEPTION 'Active authorised user required'; END IF;
  v_site := public.current_app_site_v21138('inventory');
  IF v_site IS NULL THEN RAISE EXCEPTION 'Inventory app and site access required'; END IF;
  RETURN QUERY
  SELECT s.enabled,s.alert_low_stock,s.alert_overdue_orders,s.alert_watchdog,
         s.alert_stocktake,s.alert_sync_failure
  FROM public.inventory_push_subscriptions s
  WHERE s.endpoint=p_endpoint AND s.user_id=auth.uid() AND s.site_id=v_site;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_inventory_push_preferences_v873(
 p_endpoint text,p_low_stock boolean,p_overdue_orders boolean,
 p_watchdog boolean,p_stocktake boolean,p_sync_failure boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_site uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.active=true
  ) THEN RAISE EXCEPTION 'Active authorised user required'; END IF;
  v_site := public.current_app_site_v21138('inventory');
  IF v_site IS NULL THEN RAISE EXCEPTION 'Inventory app and site access required'; END IF;
  IF p_endpoint IS NULL OR p_low_stock IS NULL OR p_overdue_orders IS NULL
    OR p_watchdog IS NULL OR p_stocktake IS NULL OR p_sync_failure IS NULL
  THEN RAISE EXCEPTION 'Invalid alert preferences'; END IF;
  UPDATE public.inventory_push_subscriptions s SET
    alert_low_stock=p_low_stock,
    alert_overdue_orders=p_overdue_orders,
    alert_watchdog=p_watchdog,
    alert_stocktake=p_stocktake,
    alert_sync_failure=p_sync_failure,
    updated_at=now()
  WHERE s.endpoint=p_endpoint AND s.user_id=auth.uid() AND s.site_id=v_site AND s.enabled=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enable phone alerts on this device before saving preferences'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_push_preferences_v873(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_inventory_push_preferences_v873(text,boolean,boolean,boolean,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_push_preferences_v873(text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_inventory_push_preferences_v873(text,boolean,boolean,boolean,boolean,boolean) TO authenticated,service_role;
