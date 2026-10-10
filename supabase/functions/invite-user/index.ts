import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function envKey(primary: string, fallback: string) {
  const raw = Deno.env.get(primary);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return parsed.default || Object.values(parsed)[0] || "";
    } catch {
      return raw;
    }
  }
  return Deno.env.get(fallback) || "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not signed in" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const publishableKey = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
    const secretKey = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
    if (!supabaseUrl || !publishableKey || !secretKey) return json({ error: "Supabase function secrets are unavailable" }, 500);

    const caller = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return json({ error: "Invalid login" }, 401);

    const { data: callerProfile } = await admin.from("profiles").select("role,active").eq("id", user.id).single();
    if (callerProfile?.role !== "admin" || callerProfile?.active === false) return json({ error: "Admin access required" }, 403);

    const body = await req.json();
    const action = String(body.action || "invite");

    if (action === "invite") {
      const email = String(body.email || "").trim();
      const displayName = String(body.display_name || "").trim();
      const role = String(body.role || "staff");
      const redirectTo = String(body.redirect_to || "").trim() || undefined;
      if (!email || !displayName) return json({ error: "Name and email are required" }, 400);
      if (!["staff", "manager", "admin"].includes(role)) return json({ error: "Invalid role" }, 400);

      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { display_name: displayName, must_set_password: true },
        redirectTo,
      });
      if (error) return json({ error: error.message }, 400);

      if (data.user?.id) {
        await admin.from("profiles").update({ display_name: displayName, email, role, active: true, disabled_at: null, disabled_by: null }).eq("id", data.user.id);
      }
      return json({ success: true, message: "Invitation sent" });
    }

    const targetId = String(body.user_id || "").trim();
    if (!targetId) return json({ error: "User is required" }, 400);
    if (targetId === user.id && ["disable", "set_role"].includes(action)) return json({ error: "You cannot disable or demote your own account here" }, 400);

    const { data: target } = await admin.from("profiles").select("id,role,active,email").eq("id", targetId).single();
    if (!target) return json({ error: "User not found" }, 404);

    if (action === "set_role") {
      const role = String(body.role || "staff");
      if (!["staff", "manager", "admin"].includes(role)) return json({ error: "Invalid role" }, 400);
      if (target.role === "admin" && role !== "admin") {
        const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("active", true);
        if ((count || 0) <= 1) return json({ error: "At least one active admin must remain" }, 400);
      }
      const { error } = await admin.from("profiles").update({ role }).eq("id", targetId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "change_email") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "A valid email address is required" }, 400);
      const oldEmail = String(target.email || "").trim().toLowerCase();
      if (email === oldEmail) return json({ success: true, message: "Email unchanged" });

      const { error: authError } = await admin.auth.admin.updateUserById(targetId, {
        email,
        email_confirm: true,
      });
      if (authError) return json({ error: authError.message }, 400);

      const { error: profileError } = await admin.from("profiles").update({ email }).eq("id", targetId);
      if (profileError) {
        if (oldEmail) {
          await admin.auth.admin.updateUserById(targetId, { email: oldEmail, email_confirm: true });
        }
        return json({ error: `Authentication email changed but profile update failed: ${profileError.message}. The authentication email was rolled back where possible.` }, 500);
      }

      return json({ success: true, email });
    }

    if (action === "disable") {
      if (target.role === "admin") {
        const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("active", true);
        if ((count || 0) <= 1) return json({ error: "The last active admin cannot be disabled" }, 400);
      }
      const { error: authError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "876000h" });
      if (authError) return json({ error: authError.message }, 400);
      const { error } = await admin.from("profiles").update({ active: false, disabled_at: new Date().toISOString(), disabled_by: user.id }).eq("id", targetId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "enable") {
      const { error: authError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "none" });
      if (authError) return json({ error: authError.message }, 400);
      const { error } = await admin.from("profiles").update({ active: true, disabled_at: null, disabled_by: null }).eq("id", targetId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
