// ============================================================================
//  Edge Function: tg-webhook
//  Telegram шлёт сюда апдейты бота. Обрабатываем оплату Stars:
//   - pre_checkout_query   → answerPreCheckoutQuery(ok) (ответить < 10с, иначе платёж отменится)
//   - successful_payment   → пишем entitlement(user_id, pack_slug) под service_role
//
//  ЗАЩИТА: setWebhook задаётся с secret_token; Telegram шлёт его в заголовке
//  X-Telegram-Bot-Api-Secret-Token. Сверяем — иначе любой POST подделает «оплату».
//
//  Секреты: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
//  Автоинжект: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//  Идемпотентность: PK entitlement (user_id, pack_slug) + on-conflict-do-nothing —
//  повтор вебхука (Telegram ретраит) не задваивает и не падает.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

async function tg(method: string, body: unknown) {
  return await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => null);
}

Deno.serve(async (req) => {
  // 200 for anything we don't act on — Telegram must not think delivery failed.
  const ok = () => new Response("ok", { status: 200 });
  try {
    if (req.method !== "POST") return ok();
    // reject forgeries: the header must match the secret we set on setWebhook
    if (!WEBHOOK_SECRET || req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await req.json().catch(() => null);
    if (!update) return ok();

    // 1) pre-checkout: approve fast, or the charge is cancelled
    if (update.pre_checkout_query) {
      await tg("answerPreCheckoutQuery", { pre_checkout_query_id: update.pre_checkout_query.id, ok: true });
      return ok();
    }

    // 2) successful payment: grant the pack
    const sp = update.message?.successful_payment;
    if (sp) {
      const payload: string = sp.invoice_payload || "";
      const sep = payload.lastIndexOf(":");        // pack_slug may contain nothing weird, but split on the LAST ':'
      const packSlug = sep > 0 ? payload.slice(0, sep) : "";
      const userId = sep > 0 ? payload.slice(sep + 1) : "";
      if (packSlug && userId) {
        const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
        await admin.from("entitlement").upsert({
          user_id: userId,
          pack_slug: packSlug,
          kind: "purchase",
          source: "telegram_stars",
          note: "tg_charge:" + (sp.telegram_payment_charge_id || "") + " stars:" + (sp.total_amount || ""),
          granted_at: new Date().toISOString(),
        }, { onConflict: "user_id,pack_slug", ignoreDuplicates: true });
      }
      return ok();
    }

    return ok();
  } catch {
    return ok();   // never 500 to Telegram — it would retry forever; we log-and-swallow
  }
});
