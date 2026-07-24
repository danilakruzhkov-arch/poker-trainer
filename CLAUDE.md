# CLAUDE.md — poker-trainer

## 1. Что это

Тренажёр покерных решений: игрок отыгрывает реальные раздачи из разборов на YouTube (автор разборов —
Андрей Козленко), отвечает как герой (фолд/колл/рейз/…), затем смотрит видео-вердикт ревьюера на том же
таймкоде. Один самодостаточный HTML-файл на GitHub Pages. UI на русском. Аудитория: игроки, которых Данила
приводит ссылками (в основном через Telegram).

Прод: https://danilakruzhkov-arch.github.io/poker-trainer/ · репо `danilakruzhkov-arch/poker-trainer` (PUBLIC, ветка `main`).

## 2. Stack / раскладка

| Слой | Что |
|---|---|
| Фронт | один самодостаточный `poker-trainer.html` (~2200 строк, ванильный JS, без фреймворка, инлайн CSS/JS) |
| Билд | `node wrap.js` → `deploy/index.html` (обёрнутый) + `deploy/version.json` (из `APP_VER`) + `.nojekyll` |
| Деплой | коммит `index.html`+`version.json` в `deploy/` (git-клон репо, ветка `main`) → push → GitHub Pages |
| Бэкап исходника | эта папка — git-репо на orphan-ветке `source` того же remote (`git push origin source`), см. `SOURCE-BRANCH.md` |
| БД | Supabase `mydnywznytluikbwbhsk`: `pack` (по-пачные строки, jsonb), `pack_version` (история, триггер), `feedback`, `ratings` (👍/👎, anon insert-only) |
| Auth | Google OAuth через Supabase SDK (jsdelivr CDN); `ADMIN_EMAILS` = 2 почты Данилы; `isAdmin()` |
| GH Action | `refresh-packs.yml` — обновляет `deploy/packs.json` из БД + keepalive-пинг (анти авто-пауза free-tier) |

- `~/Downloads/Claude Code/Code/poker-trainer/` — персистентная папка (Mac). **Источник истины — `poker-trainer.html` тут.** Сама папка = git-репо на ветке `source` (allow-list `.gitignore`, стратегички не попадают).
- `deploy/` — вложенный git-клон того же репо на ветке `main`. Там только СОБРАННОЕ (`index.html`, `version.json`, `packs.json`, setup-доки, миграции, GH Action).

## 3. Архитектура в одном абзаце

Приложение читает паки из Supabase напрямую через REST с anon-ключом. `loadPublished()` → `{cols,sig,source}`,
source ∈ `db|static|cache`. `syncPacks()` адаптирует облачные паки, когда подпись `sig` (список `slug:version`)
отличается от базовой, при этом гейтится флагом `_dirty` (есть неопубликованные локальные правки) и
`_authReady`/`isAdmin` (не-админ публиковать не может → обязан принять облако). Внизу слева диагностический
штамп `v<APP_VER> · <source>`. Видео — YouTube IFrame API со «спойлер-гардом» (watchdog возвращает скраббер
в [start,end], постоянная плашка-повтор). Автоплей — audible-first: пробуем со звуком, и если браузер отказал,
запоминаем это (`pk_noautosound`) и переходим на тап-ту-плей. Плеер подставляется вместо заглушки ВСЕГДА —
при «Автовидео: выкл» просто стоит на паузе, чтобы тап попал на кнопку ютуба внутри iframe (см. gotcha 3).

## 4. Ключевые файлы

- `poker-trainer.html` — всё приложение. `APP_VER` ~строка 1134 (текущая `2026-07-24.30`).
- `wrap.js` — билд.
- `deploy/` — репо (index.html собранный, миграции `supabase-*.sql`, `.github/` Action).
- `test-*.js` — 23 JSDOM-теста, запуск `node test-X.js` (нужен `npm install` — jsdom). Зелёные все, кроме `test-restore-catchup.js` (известно-красный, причина в шапке файла).
- `validate-hands.js`, `builder-contract.md`, `extraction-contract.md` — пайплайн извлечения рук.
- `WINDOW-2-hand-extraction.md`, `WINDOW-3-roadmap.md` — kickoff-доки для параллельных окон.
- `Q1-monetization-strategy.md`, `Q2-anticopy-security.md`, `Q3-extraction-workflow.md` — стратегички (НЕ коммитить в public-репо).

## 5. Dev workflow

```bash
npm install                 # один раз (jsdom для тестов)
node wrap.js                # собрать deploy/index.html + version.json
node test-spoiler.js        # прогнать конкретный тест
cd deploy && git add index.html version.json && git commit -m "..." && git push   # деплой
curl -s https://danilakruzhkov-arch.github.io/poker-trainer/version.json           # проверить, что выкатилось
```

Проверка прода: `curl version.json` (деплой) + claude-in-chrome на github.io (десктоп: DOM/консоль/логика).
**Мобильное поведение (автоплей/звук/жесты) десктопом НЕ воспроизводится** — только реальный телефон.

## 6. Внешние системы

- Supabase (`mydnywznytluikbwbhsk`): паки, история, фидбек, рейтинги (`ratings`). **MCP тут READ-ONLY** — все правки БД Данила делает в дашборде (SQL editor). **service_role-ключ никогда не через чат.**
- GitHub Pages — хостинг. GitHub Action — keepalive пинг.
- YouTube IFrame API — видео-разборы.

## 7. Project policies — не пере-предлагать

- Один самодостаточный HTML, без фреймворка/сборщика (кроме `wrap.js`). Не разбивать на модули без запроса.
- Паки в БД по-пачно (`pack`), НЕ одним блобом (старая `packs` была причиной data-loss, снесена 2026-07-23).
- Правки БД — через дашборд, не через MCP.
- RU UI, casual тон.

## 8. Gotchas (самое консультируемое)

1. **Две ветки одного репо, две рабочие папки.** Персистентная папка = ветка `source` (исходник), вложенная `deploy/` = ветка `main` (собранное + Pages). Правишь `poker-trainer.html` тут, `node wrap.js`, коммитишь собранное в `deploy/`, исходник — в корне. Не перепутать.
2. **TG staleness ≠ кэш HTML.** Встроенный браузер Telegram показывал старые паки из-за флага `_dirty:true` в localStorage от старой сессии → syncPacks пропускал адаптацию облака. Фикс: гейт `if(!_dirty||(_authReady&&!isAdmin()))` + ре-синк после auth (.21). Диагностировано штампом `· db` при старых паках.
3. **Мобильный аудио-автоплей невозможен без жеста** (iOS WebKit, Chrome Android — платформенная политика). Разрешён только muted. Исключение — Telegram WebView. НЕ форсить `mute=1` безусловно (регресс .16). `.22` = audible-first + детект отказа на 1.4с → `markNoAutoSound()`.
3a. **Жест iOS НЕ переносится в свежесозданный кросс-доменный iframe.** Поэтому тап по нашей заглушке не мог запустить видео — он лишь создавал iframe, который вставал на паузу, и требовался второй тап по кнопке ютуба. `.24`: плеер подставляется заранее и при выключенном автовидео стоит на паузе → один тап. `embedFacade(fac,auto,play)` — `auto` = «мы стартуем сами» (арм детекта), `play` = «должен ли играть». Заглушка остаётся только там, где встраивание блокируется CSP.
3b. **`position:fixed; left:50%` без явной ширины сжимается в оставшиеся 50% вьюпорта** — `max-width` до дела не доходит. Из-за этого тост становился вертикальной колонкой на телефоне. Лечится `width:max-content` + `max-width:min(92vw,560px)`.
4. **«Мой набор» подчиняется фильтру `hidden`** как любой скрытый пак (`hidden:true` по умолчанию, .20) — без отдельной логики показа.
5. **Синк по `sig`, не по `publishedAt`** (`pub.sig!==_syncedSig`).
6. **Глобалы через `let` не на `window`** (`_ytPlayers`, `VTIMERS`) — при отладке в консоли читать без `window.`.
7. **Мёртвый код:** `updateReplayBtn()` ищет кнопку `replayToggle`, которой в DOM нет.
8. **`gate: free|login|pro`** — отдельный от paywall UX-задел (бейджи «вход»/PRO). Платный сплит (P1а) сделан отдельно: платные раздачи в `pack_locked` (RLS, anon → 401), бесплатные в `pack.data`. Не путать эти два механизма.
9. **Paywall-архитектура (.25–.28).** Платные раздачи НИКОГДА не в публичном `pack.data`/`packs.json` — только в `pack_locked`, читается user-JWT (RLS). Публикация = RPC `pack_apply_split` (сплитит по флагу `{paid:true}` на раздаче, сервер, одна транзакция). Клиент держит `PAYWALL/OWNED/LOCKED/PRICE_LOCAL` **вне COLS** (иначе админский publish зальёт платное в anon-строку). Цена — колонка `price_rub` (единственный источник правды), `PRICE_LOCAL` — только неопубликованная правка, персистится в localStorage. `demo`: `price_rub=0` → любой залогиненный сам открывает через `claim_free_pack`.
10. **Инцидент дублирования (2026-07-24, .27).** `loadLocked()` обнулял `LOCKED={}` синхронно, а заполнял после `await` → два наложенных вызова (boot `refreshOwned` + `onAuthStateChange`) писали в один объект, платные раздачи задваивались, `mergeLockedIntoCols` вклеивал дубли в COLS, **автопубликация** уносила в БД, на след. загрузке цикл повторялся (mtt16k дорос до 108 строк = 3×36). Фиксы: `loadLocked` строит в локальные карты + swap под `_lockGen`; **автопубликация убрана** (теперь кнопка «Опубликовать» + «Вернуть из БД»); `LS_V` стемп чистит старые сейвы. Восстановление — `deploy/supabase-paywall-restore.sql` из снапшотов `pack_version`. Регресс — `test-paywall.js`.
11. **Единая тёмная тема (.28).** `.app`/стол зашиты тёмными в любой теме, поэтому светлая системная тема ломала контраст (тёмный `--text` на тёмном фетре — текст стены исчезал). Убран `@media (prefers-color-scheme:light)`, `:root{color-scheme:dark}`. `[data-theme]` хуки в CSS живы под будущий тумблер, но никем не ставятся. `.gate-*` цвета захардкожены светлыми.
12. **OAuth reload теряет контекст drill.** Google-вход перезагружает страницу → игрок падал на список подборок. `armResume(packId)` перед входом → `consumeResume()` после auth открывает стену обратно. `pk_resume` в localStorage, TTL 10 мин.
13. **`.table::after` (декоративный овал) перехватывал клики** внутри фетра (`position:absolute` поверх контента). Только gate/paywall кладут туда кнопки — отсюда «кнопки на стене не нажимаются». Лечится `pointer-events:none` (.28).
14. **Роли (.29, P1б).** `admin` (2 почты, хардкод `ADMIN_EMAILS`) / `editor` (`public.app_editor`, БД) / `player`. Клиент: `my_role()` RPC → `MYROLE`+`_rolesReady`; **graceful fallback** — без применённой миграции `_rolesReady=false`, редактор-роль и модерация НЕ активны, билд ведёт себя как админ-only. `canEdit()`=admin∨editor (правит паки), `canModerate()`=`_rolesReady`∧(admin∨editor). Экран модерации (вкладка 🛡): читает `feedback` под JWT (RLS), «Пометить обработанным» → PATCH `resolved`. Редактор = **только паки**: ни грантов, ни ролей, ни чужих данных. Миграция `deploy/supabase-roles-moderation.sql` (Данила руками, ПРИМЕНЕНА 24.07). Добавить редактора: `insert into app_editor(email) values (...)`.
15. **Telegram Mini App (.30, P2.1).** Клиент в проде, но **инертен** до деплоя Edge Functions (graceful auto-detect, как роли). `inTelegramShell()` (детект по `TelegramWebviewProxy`/hash) → SDK грузится ЛЕНИВО только в телеге (веб не трогается, нулевая регрессия). `tgSignIn()`: initData → Edge `tg-auth` → OTP → `verifyOtp` → Supabase-сессия (вход НЕ через Google — Google-OAuth ломается в webview телеги). `tgBuy()`: Edge `tg-invoice` → `openInvoice` (Stars, currency XTR). Оплату зачисляет `tg-webhook` (проверяет secret-заголовок, пишет `entitlement` под service_role, идемпотентно по PK). initData валидируется HMAC на СЕРВЕРЕ (`_shared/initdata.ts`), клиенту веры нет. Файлы: `deploy/edge/{tg-auth,tg-invoice,tg-webhook}`, `deploy/supabase-telegram.sql` (`telegram_link`), инструкция `deploy/TELEGRAM-SETUP.md`. Тесты — `test-telegram.js`. **Ждёт от Данилы:** бот @BotFather + токен, применить миграцию, задеплоить 3 функции (`--no-verify-jwt`), setWebhook, цены `pack.price_rub`. До этого прод = поведение .29.

## 9. Conventions

- RU, casual «ты». Без эмодзи в коде/конфигах/коммитах. Коммиты кончаются `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- UI-правки — верифицировать в браузере (claude-in-chrome для github.io; встроенный Browser pane блокирует github.io + localhost).
- Стратегички (Q1/Q2/Q3, WINDOW-*, `*-contract.md`) — приватные, в git не коммитить. `.gitignore` устроен как allow-list, так что `git add -A` их не утащит; при добавлении нового исходника его нужно явно раз-игнорить.
- **Путь проекта содержит пробел** («Claude Code») — в скриптах и `execSync` пути обязательно в кавычках.

## 10. Роадмап (окно 3)

P1 база v1 (БД/логин/free-paid → роли/модерация → редакторские паки) → P2 монетизация (TG Stars → РУ-платежи → межд. карты → моб) → P3 анти-копирование (параллельно с первым платным). Детали — `WINDOW-3-roadmap.md`.

**Статус:** P1(а) free/paid split — СДЕЛАНО (.25–.28). P1(б) роли + модерация — СДЕЛАНО (.29), миграция ПРИМЕНЕНА 24.07. **P2.1 Telegram Mini App — КЛИЕНТ + Edge Functions + миграция НАПИСАНЫ (.30), инертны в проде до деплоя серверной части** (см. gotcha 15 + `deploy/TELEGRAM-SETUP.md`). Ждёт от Данилы: бот+токен, применить `supabase-telegram.sql`, задеплоить функции, setWebhook, цены. Переезд на свой сервер — НЕ блокер (Edge Functions на Supabase, Pages https подходит под Mini App), домен позже (`clippoints.com` забракован). P3 анти-копи: Layer 1 (RLS split) готов, backend-аудит чист; watermark/Edge-гейтинг/rate-limit — вместе с первым платным паком (после P2).

## 11. Vault

Долгосрочная память (решения/инциденты/«почему») — `~/obsidian-vault/wiki/projects/poker-trainer/`.

<!-- updated-by-superflow:2026-07-24 -->
