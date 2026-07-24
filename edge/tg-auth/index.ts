// ============================================================================
//  Edge Function: tg-auth
//  Вход в Telegram Mini App. Клиент шлёт Telegram.WebApp.initData → мы проверяем
//  подпись (HMAC ботом) → находим/создаём Supabase-юзера, привязанного к telegram_id
//  → выдаём одноразовый OTP. Клиент меняет OTP на настоящую сессию (verifyOtp),
//  после чего entitlement/pack_locked читаются по его JWT как на вебе.
//
//  Секреты (Supabase → Edge Functions → Secrets):
//    TELEGRAM_BOT_TOKEN   — токен бота от @BotFather
//    ALLOWED_ORIGINS      — (опц.) список origin через запятую; по умолч. Pages URL
//  Автоинжектятся: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//  БЕЗ initData никто не войдёт: подделать подпись без токена бота нельзя.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateInitData, tgEmail, corsHeaders } from "../_shared/initdata.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ALLOWED = Deno.env.get("ALLOWED_ORIGINS") ||
  "https://danilakruzhkov-arch.github.io";

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"), ALLOWED);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    if (!BOT_TOKEN) return json({ error: "bot token not configured" }, 500);

    const { initData } = await req.json().catch(() => ({}));
    const v = await validateInitData(initData, BOT_TOKEN);
    if (!v.ok || !v.user) return json({ error: "invalid initData: " + (v.reason || "") }, 401);

    const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const email = tgEmail(v.user.id);

    // magiclink generateLink CREATES the user if missing and returns an OTP.
    // No email is sent — we hand the OTP straight back to the client to verify.
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data?.user) return json({ error: "auth link failed: " + (error?.message || "") }, 500);

    // remember the mapping (telegram_id -> user_id) for the Stars webhook + audit
    await admin.from("telegram_link").upsert({
      telegram_id: v.user.id,
      user_id: data.user.id,
      username: v.user.username ?? null,
      first_name: v.user.first_name ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "telegram_id" });

    // email_otp: the 6-digit code the client verifies to get a session.
    // (If a future supabase-js rejects type:'email' here, switch the CLIENT to
    //  verifyOtp({token_hash: hashed_token, type:'magiclink'}) — see TELEGRAM-SETUP.md.)
    const props = data.properties as Record<string, string> | undefined;
    return json({
      email,
      otp: props?.email_otp || null,
      token_hash: props?.hashed_token || null,
      user_id: data.user.id,
    });
  } catch (e) {
    return json({ error: "server error: " + ((e as Error)?.message || "") }, 500);
  }
});
