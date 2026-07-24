// ============================================================================
//  Telegram Web App initData validation (Deno / Web Crypto).
//  SECURITY-CRITICAL: this is the ONLY proof that a request really comes from a
//  Telegram user. If this is wrong, anyone can forge a session. Do not "simplify".
//
//  Algorithm (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
//   1. parse initData as a query string; pull out `hash`
//   2. data_check_string = remaining `key=value` pairs, sorted by key, joined by "\n"
//   3. secret_key = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)
//   4. computed   = hex( HMAC_SHA256(key=secret_key, msg=data_check_string) )
//   5. valid iff computed === hash  (constant-time compare)
//   6. reject if auth_date older than maxAgeSec (replay window)
//
//  The exact same logic is unit-tested in test-telegram.js (Node Web Crypto).
// ============================================================================

async function hmacSha256(keyBytes: Uint8Array, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}
function toHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// constant-time string compare (avoid timing oracle on the hash)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}
export interface InitDataResult {
  ok: boolean;
  reason?: string;
  user?: TgUser;
  authDate?: number;
}

export async function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86400,
): Promise<InitDataResult> {
  if (!initData || !botToken) return { ok: false, reason: "missing initData or token" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "no hash" };
  params.delete("hash");

  const pairs: string[] = [];
  for (const [k, v] of params) pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const computed = toHex(await hmacSha256(secretKey, dataCheckString));
  if (!timingSafeEqual(computed, hash)) return { ok: false, reason: "bad hash" };

  // freshness: block replay of an old initData
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!authDate || nowSec - authDate > maxAgeSec) return { ok: false, reason: "stale auth_date" };

  let user: TgUser | undefined;
  try { const raw = params.get("user"); if (raw) user = JSON.parse(raw); } catch { /* ignore */ }
  if (!user || !user.id) return { ok: false, reason: "no user" };

  return { ok: true, user, authDate };
}

// Synthetic, stable Supabase email for a Telegram identity. No real inbox — we
// never send mail; generateLink issues an OTP we hand straight back to the client.
export function tgEmail(userId: number): string {
  return `tg${userId}@telegram.local`;
}

// CORS: allow the app origin(s). Pass a comma-separated ALLOWED_ORIGINS env to widen.
export function corsHeaders(origin: string | null, allowed: string): Record<string, string> {
  const list = allowed.split(",").map((s) => s.trim()).filter(Boolean);
  const allow = origin && list.includes(origin) ? origin : list[0] || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
