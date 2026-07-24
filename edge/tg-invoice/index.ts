// ============================================================================
//  Edge Function: tg-invoice
//  Создаёт ссылку на оплату пака в Telegram Stars. Клиент открывает её через
//  Telegram.WebApp.openInvoice(link). Оплату подтверждает tg-webhook.
//
//  Тело: { initData, pack_slug }
//  Возврат: { invoice_link } | { free:true } (пак бесплатный → claim_free_pack)
//
//  Секреты: TELEGRAM_BOT_TOKEN, (опц.) RUB_PER_STAR, ALLOWED_ORIGINS
//  Автоинжект: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//  Цена: пак хранит price_rub (единственный источник правды). Stars считаем как
//  ceil(price_rub / RUB_PER_STAR). RUB_PER_STAR ~1.3 → 490₽ ≈ 377★ (диапазон Q1
//  350–500★ ≈ $5). Настраивается секретом, схему пака не трогаем.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateInitData, corsHeaders } from "../_shared/initdata.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RUB_PER_STAR = parseFloat(Deno.env.get("RUB_PER_STAR") || "1.3") || 1.3;
const ALLOWED = Deno.env.get("ALLOWED_ORIGINS") || "https://danilakruzhkov-arch.github.io";

async function tg(method: string, body: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"), ALLOWED);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    if (!BOT_TOKEN) return json({ error: "bot token not configured" }, 500);

    const { initData, pack_slug } = await req.json().catch(() => ({}));
    if (!pack_slug) return json({ error: "no pack_slug" }, 400);
    const v = await validateInitData(initData, BOT_TOKEN);
    if (!v.ok || !v.user) return json({ error: "invalid initData: " + (v.reason || "") }, 401);

    const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // who is this Telegram user in Supabase terms (set by tg-auth on login)
    const { data: link } = await admin.from("telegram_link")
      .select("user_id").eq("telegram_id", v.user.id).maybeSingle();
    if (!link?.user_id) return json({ error: "not linked — call tg-auth first" }, 409);

    // pack + price straight from the source of truth
    const { data: pack } = await admin.from("pack")
      .select("slug, price_rub, data").eq("slug", pack_slug).maybeSingle();
    if (!pack) return json({ error: "pack not found" }, 404);
    const priceRub = (pack.price_rub | 0);
    if (priceRub <= 0) return json({ free: true });   // free pack: client uses claim_free_pack, not Stars

    // already owns it? (idempotent UX — no double charge)
    const { data: owns } = await admin.from("entitlement")
      .select("pack_slug").eq("user_id", link.user_id).eq("pack_slug", pack_slug).maybeSingle();
    if (owns) return json({ owned: true });

    const stars = Math.max(1, Math.ceil(priceRub / RUB_PER_STAR));
    const title = (pack.data?.name || pack_slug).toString().slice(0, 32);

    // createInvoiceLink (NOT sendInvoice) — for Mini App openInvoice. Stars: currency XTR, no provider_token.
    // payload binds the payment to (pack, user) so the webhook knows who to grant.
    const res = await tg("createInvoiceLink", {
      title,
      description: "Доступ к платным раздачам подборки — разово, остаётся навсегда.",
      payload: `${pack_slug}:${link.user_id}`,
      currency: "XTR",
      prices: [{ label: title, amount: stars }],
    });
    if (!res?.ok || !res.result) return json({ error: "invoice failed: " + JSON.stringify(res?.description || res) }, 502);

    return json({ invoice_link: res.result, stars });
  } catch (e) {
    return json({ error: "server error: " + ((e as Error)?.message || "") }, 500);
  }
});
