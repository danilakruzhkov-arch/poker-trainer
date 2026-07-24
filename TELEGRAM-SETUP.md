# Telegram Mini App + Stars — включение (P2.1)

Клиент (`.30`) уже в проде и **инертен**: вне Telegram ничего не меняется, а в Telegram тихо
откатывается на текущий Google-вход, пока не задеплоены Edge Functions. Ниже — шаги, чтобы
включить. Всё, что не сделать руками (миграция, деплой функций, секреты, бот) — тут. Каждый шаг
самостоятельный; после шага 5 можно тестить.

Что строит: вход в Mini App одним тапом (Telegram initData → Supabase-сессия), оплата паков в
Telegram Stars, зачисление доступа вебхуком. Модель `entitlement`/`pack_locked` — та же, что на вебе.

---

## Что от тебя (короткий чеклист)

- [ ] 1. Бот в @BotFather → токен
- [ ] 2. Миграция `supabase-telegram.sql` (SQL editor)
- [ ] 3. Секреты Edge Functions
- [ ] 4. Деплой 3 функций
- [ ] 5. setWebhook
- [ ] 6. Цены паков + тест на телефоне

Токен бота и секреты — **только в дашборде Supabase**, никогда в чат/репо/HTML.

---

## 0. Пререквизит: Supabase CLI (один раз)

```bash
npm i -g supabase
supabase login
supabase link --project-ref mydnywznytluikbwbhsk
```

## 1. Бот (@BotFather)

1. `/newbot` → имя + username → получаешь **токен** (`123456:ABC...`).
2. `/newapp` (или `/mybots` → Bot Settings → Menu Button / Web App) → задай **Web App URL**:
   `https://danilakruzhkov-arch.github.io/poker-trainer/`
3. Придумай **webhook-секрет** — любая длинная строка (например `openssl rand -hex 32`). Понадобится в шагах 3 и 5.

## 2. Миграция (Supabase → SQL editor)

Выполни `deploy/supabase-telegram.sql` (создаёт `telegram_link`). Идемпотентно. В конце покажет `telegram_link ready`.

## 3. Секреты Edge Functions (дашборд → Edge Functions → Secrets, или CLI)

```bash
supabase secrets set TELEGRAM_BOT_TOKEN='<токен из шага 1>'
supabase secrets set TELEGRAM_WEBHOOK_SECRET='<секрет из шага 1.3>'
# опционально:
supabase secrets set RUB_PER_STAR='1.3'                 # 490₽ ≈ 377★ (диапазон Q1: 350–500★)
supabase secrets set ALLOWED_ORIGINS='https://danilakruzhkov-arch.github.io'
```
`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Supabase инжектит сам — их задавать НЕ надо.

## 4. Деплой функций (`--no-verify-jwt` обязателен)

Скопируй `deploy/edge/*` в `supabase/functions/` (структура: `supabase/functions/tg-auth/index.ts`,
`.../tg-invoice/index.ts`, `.../tg-webhook/index.ts`, `.../_shared/initdata.ts`), затем:

```bash
supabase functions deploy tg-auth    --no-verify-jwt
supabase functions deploy tg-invoice --no-verify-jwt
supabase functions deploy tg-webhook --no-verify-jwt
```
`--no-verify-jwt` нужен, потому что вебхук зовёт **Telegram** (без Supabase-JWT), а tg-auth/tg-invoice
сами проверяют подпись initData. Гейт — не gateway-JWT, а HMAC-валидация и секрет вебхука.

> Могу задеплоить их за тебя через MCP, когда скажешь, — но авторизационный код лучше сначала глянуть глазами.

## 5. Привязать вебхук

```bash
curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook" \
  -d "url=https://mydnywznytluikbwbhsk.supabase.co/functions/v1/tg-webhook" \
  -d "secret_token=<секрет из шага 1.3>" \
  -d 'allowed_updates=["pre_checkout_query","message"]'
```
Проверка: `curl https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo` → `url` стоит, `pending_update_count` низкий.

## 6. Цены + тест

- Цена пака = колонка `pack.price_rub` (0 = бесплатный, открывается через `claim_free_pack` без Stars).
  Поставь платным, например: `update pack set price_rub=490 where slug='mtt16k';` (в дашборде).
- Открой бота на телефоне → Mini App → должен войти сам (без Google) → на платной раздаче кнопка
  «Разблокировать» откроет нативную оплату Stars → после оплаты пак откроется.

---

## Обмен OTP на сессию — версионно-устойчив

`tgSignIn` перебирает все формы `verifyOtp`, что использовал supabase-js в разных версиях
(email-OTP → token_hash/email → token_hash/magiclink), первый успешный побеждает. Сервер отдаёт и
`email_otp`, и `hashed_token`. Ничего руками подбирать не нужно — если вход не проходит, смотри
Network-вкладку: ответ `tg-auth` (есть ли `otp`/`token_hash`) и ошибку `verifyOtp`.

## Безопасность (заложено, для контроля)

- initData валидируется **на сервере** по HMAC (`_shared/initdata.ts`), клиентскому user_id веры нет.
- Вебхук сверяет `X-Telegram-Bot-Api-Secret-Token` — без совпадения 403 (иначе подделают «оплату»).
- `entitlement` пишет только `service_role` (в функции), с клиента запись закрыта RLS.
- Зачисление идемпотентно (PK + on-conflict-do-nothing) — ретрай вебхука не задваивает.
- Бот-токен и webhook-секрет — только в секретах Edge Functions.

## Откат

- Убрать вебхук: `curl https://api.telegram.org/bot<ТОКЕН>/deleteWebhook`.
- Клиент откатывать не нужно: без задеплоенных функций Mini App сам падает на Google-вход.
