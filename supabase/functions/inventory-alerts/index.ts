import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type Candidate = {
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  event_key: string;
  event_hash: string;
  title: string;
  body: string;
  severity: string;
  target_url: string | null;
  source_alert_id: string | null;
};

const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type":"application/json", "cache-control":"no-store" }
});

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({error:"Server configuration unavailable"},500);

  const sb = createClient(supabaseUrl, serviceKey, {
    auth:{persistSession:false,autoRefreshToken:false}
  });

  const { data: runtimeRows, error: runtimeError } = await sb.rpc("inventory_push_runtime_v872");
  if (runtimeError) return json({error:runtimeError.message},500);
  const runtime = Array.isArray(runtimeRows) ? runtimeRows[0] : runtimeRows;
  if (!runtime?.enabled) return json({ok:true,disabled:true});

  const supplied = new URL(req.url).searchParams.get("key") || "";
  if (!runtime?.scheduler_secret || supplied !== runtime.scheduler_secret) {
    return json({error:"Unauthorized"},401);
  }

  let vapidPublic = String(runtime.vapid_public_key || "");
  let vapidPrivate = String(runtime.vapid_private_key || "");
  if (!vapidPublic || !vapidPrivate) {
    const generated = webpush.generateVAPIDKeys();
    vapidPublic = generated.publicKey;
    vapidPrivate = generated.privateKey;
    const { error } = await sb.from("inventory_push_runtime_config")
      .update({
        vapid_public_key:vapidPublic,
        vapid_private_key:vapidPrivate,
        updated_at:new Date().toISOString()
      })
      .eq("singleton",true);
    if (error) return json({error:"Could not initialise Web Push keys: "+error.message},500);
  }

  webpush.setVapidDetails(
    "https://grich295.github.io/inventory-tracker/",
    vapidPublic,
    vapidPrivate
  );

  const { data:candidateRows, error:candidateError } = await sb.rpc("inventory_push_candidates_v872");
  if (candidateError) return json({error:candidateError.message},500);
  const candidates = (candidateRows || []) as Candidate[];
  if (!candidates.length) return json({ok:true,candidates:0,sent:0,skipped:0,failed:0});

  const keys = [...new Set(candidates.map(x=>x.event_key))];
  const { data:stateRows } = await sb.from("inventory_push_event_state")
    .select("event_key,event_hash,last_sent_at")
    .in("event_key",keys);
  const state = new Map((stateRows || []).map((x:any)=>[x.event_key,x]));

  let sent=0,skipped=0,failed=0,disabled=0;
  const now=Date.now();
  for (const c of candidates) {
    const previous:any = state.get(c.event_key);
    const age = previous?.last_sent_at ? now-new Date(previous.last_sent_at).getTime() : Infinity;
    const repeatMs = c.severity==="CRITICAL" ? 6*60*60*1000 : 24*60*60*1000;
    if (previous && previous.event_hash===c.event_hash && age<repeatMs) {
      skipped++;
      continue;
    }

    const payload = JSON.stringify({
      title:c.title,
      body:c.body,
      icon:"./icon.svg",
      badge:"./icon.svg",
      url:c.target_url || "./",
      tag:c.event_key,
      severity:c.severity
    });

    try {
      await webpush.sendNotification({
        endpoint:c.endpoint,
        keys:{p256dh:c.p256dh,auth:c.auth}
      }, payload, { TTL: 60*60*6, urgency: c.severity==="CRITICAL" ? "high" : "normal" });

      sent++;
      await sb.from("inventory_push_subscriptions")
        .update({last_success_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()})
        .eq("id",c.subscription_id);

      await sb.from("inventory_push_event_state").upsert({
        event_key:c.event_key,
        event_hash:c.event_hash,
        last_sent_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      },{onConflict:"event_key"});

      if (c.source_alert_id) {
        await sb.from("inventory_client_alerts")
          .update({status:"SENT",updated_at:new Date().toISOString()})
          .eq("id",c.source_alert_id)
          .eq("status","OPEN");
      }
    } catch (e:any) {
      failed++;
      const code = Number(e?.statusCode || e?.status || 0);
      const message = String(e?.body || e?.message || "Push delivery failed").slice(0,500);
      if (code===404 || code===410) {
        disabled++;
        await sb.from("inventory_push_subscriptions")
          .update({enabled:false,last_error:message,updated_at:new Date().toISOString()})
          .eq("id",c.subscription_id);
      } else {
        await sb.from("inventory_push_subscriptions")
          .update({last_error:message,updated_at:new Date().toISOString()})
          .eq("id",c.subscription_id);
      }
    }
  }

  return json({ok:true,candidates:candidates.length,sent,skipped,failed,disabled});
});