# Настройка входа через Google (Stage 3a)

Делаешь **ты** — это твои консоли и секреты, мне их передавать не нужно. ~15 минут.
Порядок важен: сначала Google, потом Supabase (во второй шаг понадобятся ключи из первого).

## Шаг 0. Применить миграцию БД

Supabase → **SQL Editor** → New query → вставь весь [`supabase-auth-migration.sql`](supabase-auth-migration.sql) → **Run**.
Создаст таблицу `profiles` (профиль на каждого юзера, авто-создаётся при первом входе).

## Шаг 1. Google Cloud Console — OAuth client

1. https://console.cloud.google.com → выбери проект (или создай новый, имя любое).
2. **APIs & Services → OAuth consent screen**:
   - User Type: **External** → Create.
   - App name: `Покер-тренажёр`, User support email: свой, Developer contact: свой. Save and continue.
   - Scopes: можно ничего не добавлять (email/profile/openid идут по умолчанию) → Save and continue.
   - Test users: пока в статусе Testing можно добавить свой email. Позже нажмёшь **Publish app**, чтобы вход открылся всем.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: `poker-trainer web`.
   - **Authorized JavaScript origins** → Add URI:
     ```
     https://danilakruzhkov-arch.github.io
     ```
   - **Authorized redirect URIs** → Add URI (это Supabase-callback, НЕ твой сайт):
     ```
     https://mydnywznytluikbwbhsk.supabase.co/auth/v1/callback
     ```
   - Create → скопируй **Client ID** и **Client Secret**.

## Шаг 2. Supabase — включить Google

1. Supabase → **Authentication → Sign In / Providers → Google**:
   - Enable → вставь **Client ID** и **Client Secret** из шага 1 → **Save**.
2. Supabase → **Authentication → URL Configuration**:
   - **Site URL**:
     ```
     https://danilakruzhkov-arch.github.io/poker-trainer/
     ```
   - **Redirect URLs** → Add URL:
     ```
     https://danilakruzhkov-arch.github.io/poker-trainer/**
     ```
   - (для локальных тестов можно добавить ещё `http://localhost:8137/**`)

## Шаг 3. Скажи мне «готово»

Код входа я задеплою параллельно. Как настроишь — жмём «Войти через Google» и проверяем реальный вход вместе.

---

### Частые грабли
- **redirect_uri_mismatch** — в Google redirect URI должен быть ровно `https://mydnywznytluikbwbhsk.supabase.co/auth/v1/callback` (Supabase-домен, не твой сайт).
- **Вход только у тебя** — consent screen в статусе *Testing*. Нажми **Publish app**, чтобы пускало всех.
- **После входа выкидывает на главную без сессии** — проверь, что Site URL и Redirect URLs в Supabase совпадают с адресом сайта (со слэшем на конце).
- Секреты (Client Secret) живут **только** в Supabase. В код сайта они не попадают и мне не нужны.
