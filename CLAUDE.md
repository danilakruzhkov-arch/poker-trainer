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
| Деплой | коммит `index.html`+`version.json` в `deploy/` (git-клон репо) → push → GitHub Pages |
| БД | Supabase `mydnywznytluikbwbhsk`: `pack` (по-пачные строки, jsonb), `pack_version` (история, триггер), `feedback`, `ratings` (👍/👎, anon insert-only) |
| Auth | Google OAuth через Supabase SDK (jsdelivr CDN); `ADMIN_EMAILS` = 2 почты Данилы; `isAdmin()` |
| GH Action | `refresh-packs.yml` — обновляет `deploy/packs.json` из БД + keepalive-пинг (анти авто-пауза free-tier) |

- `~/Downloads/Claude Code/Code/poker-trainer/` — персистентная папка (Mac). **Источник истины — `poker-trainer.html` тут.**
- `deploy/` — git-клон PUBLIC-репо. В репо лежит только СОБРАННОЕ (`index.html`, `version.json`, `packs.json`, setup-доки, миграции, GH Action). Исходник `poker-trainer.html`/`wrap.js`/тесты в репо пока НЕ бэкапятся (см. gotcha 1).

## 3. Архитектура в одном абзаце

Приложение читает паки из Supabase напрямую через REST с anon-ключом. `loadPublished()` → `{cols,sig,source}`,
source ∈ `db|static|cache`. `syncPacks()` адаптирует облачные паки, когда подпись `sig` (список `slug:version`)
отличается от базовой, при этом гейтится флагом `_dirty` (есть неопубликованные локальные правки) и
`_authReady`/`isAdmin` (не-админ публиковать не может → обязан принять облако). Внизу слева диагностический
штамп `v<APP_VER> · <source>`. Видео — YouTube IFrame API со «спойлер-гардом» (watchdog возвращает скраббер
в [start,end], постоянная плашка-повтор). Автоплей — audible-first с muted-фолбэком + плашкой «включить звук».

## 4. Ключевые файлы

- `poker-trainer.html` — всё приложение. `APP_VER` ~строка 1106 (текущая `2026-07-23.22`).
- `wrap.js` — билд.
- `deploy/` — репо (index.html собранный, миграции `supabase-*.sql`, `.github/` Action).
- `test-*.js` — ~24 JSDOM-теста, запуск `node test-X.js` (нужен `npm install` — jsdom). Весь сьют сейчас зелёный.
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

1. **Исходник жил только в эфемерном scratchpad** — перенесён в персистентную папку 2026-07-23. В public-репо только собранный `index.html`. Работать с исходником — ТУТ, в персистентной папке.
2. **TG staleness ≠ кэш HTML.** Встроенный браузер Telegram показывал старые паки из-за флага `_dirty:true` в localStorage от старой сессии → syncPacks пропускал адаптацию облака. Фикс: гейт `if(!_dirty||(_authReady&&!isAdmin()))` + ре-синк после auth (.21). Диагностировано штампом `· db` при старых паках.
3. **Мобильный аудио-автоплей невозможен без жеста** (iOS WebKit, Chrome Android — платформенная политика). Разрешён только muted. Исключение — Telegram WebView. НЕ форсить `mute=1` безусловно (регресс .16). `.22` = audible-first + плашка только при реальном блоке (детект на 1.4с).
4. **«Мой набор» подчиняется фильтру `hidden`** как любой скрытый пак (`hidden:true` по умолчанию, .20) — без отдельной логики показа.
5. **Синк по `sig`, не по `publishedAt`** (`pub.sig!==_syncedSig`).
6. **Глобалы через `let` не на `window`** (`_ytPlayers`, `VTIMERS`) — при отладке в консоли читать без `window.`.
7. **Мёртвый код:** `updateReplayBtn()` ищет кнопку `replayToggle`, которой в DOM нет.
8. **`gate: free|login|pro` уже есть в клиенте** (бейджи PRO/«вход», ~строка 1366) — это UX-задел, НЕ энфорсмент. До RLS-сплита free/paid платный контент утечёт (он в том же публичном REST-ответе). Реальный гейтинг — задача P1(а).

## 9. Conventions

- RU, casual «ты». Без эмодзи в коде/конфигах/коммитах. Коммиты кончаются `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- UI-правки — верифицировать в браузере (claude-in-chrome для github.io; встроенный Browser pane блокирует github.io + localhost).
- Стратегички (Q1/Q2) — приватные, в public-репо не коммитить.

## 10. Роадмап (окно 3)

P1 база v1 (БД/логин/free-paid → роли/модерация → редакторские паки) → P2 монетизация (TG Stars → РУ-платежи → межд. карты → моб) → P3 анти-копирование (параллельно с первым платным). Детали — `WINDOW-3-roadmap.md`.

## 11. Vault

Долгосрочная память (решения/инциденты/«почему») — `~/obsidian-vault/wiki/projects/poker-trainer/`.

<!-- updated-by-superflow:2026-07-23 -->
