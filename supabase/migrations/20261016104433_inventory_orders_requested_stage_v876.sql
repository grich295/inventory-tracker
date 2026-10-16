-- Live migration: requested items are not supplier orders.
ALTER TABLE public.purchase_orders
 ADD COLUMN IF NOT EXISTS requested_at timestamptz,
 ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.purchase_orders ALTER COLUMN ordered_at DROP NOT NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN ordered_by DROP NOT NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN supplier_name DROP NOT NULL;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_requested_state_v876
 CHECK (status<>'REQUESTED' OR (
   requested_at IS NOT NULL AND requested_by IS NOT NULL
   AND ordered_at IS NULL AND ordered_by IS NULL
   AND quantity_received=0 AND quantity_ordered>0
 ));
CREATE INDEX IF NOT EXISTS purchase_orders_requested_queue_v876
 ON public.purchase_orders(site_id,requested_at DESC) WHERE status='REQUESTED';
CREATE INDEX IF NOT EXISTS purchase_orders_requested_by_v876
 ON public.purchase_orders(requested_by) WHERE requested_by IS NOT NULL;
