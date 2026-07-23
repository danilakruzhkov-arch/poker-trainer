# Ветка `source`

Бэкап исходника тренажёра. **Не связана с `main`** — это orphan-ветка, у неё своя история.

| Ветка | Что лежит | Кто читает |
|---|---|---|
| `main` | собранный `index.html`, `version.json`, `packs.json`, миграции, GH Action | GitHub Pages |
| `source` | `poker-trainer.html` (исходник), `wrap.js` (билд), `test-*.js`, `CLAUDE.md` | человек/Claude |

## Почему отдельной веткой

`main` — корень GitHub Pages, там уже лежит собранный `index.html`. Положить исходник туда же —
значит держать две копии одного кода в одной ветке и рано или поздно их разъехать. Orphan-ветка
даёт бэкап без дубликата и без влияния на Pages.

## Что сюда НЕ попадает

Стратегические доки (монетизация, анти-копирование, методика извлечения рук) и per-window kickoff-доки.
Они приватные и живут в вики: `~/obsidian-vault/wiki/projects/poker-trainer/`.
`.gitignore` устроен как allow-list (`*` + `!` на нужное) — случайный `git add -A` ничего не утащит.

Контент паков (`packs.json`) — это отдельная история: он лежит в `main` и отдаётся публично.
Снятие его с публичной раздачи — задача P1(а)/P3, см. `WINDOW-3-roadmap.md`.

## Команды

```bash
git add -A && git commit -m "..." && git push origin source
```

Деплой при этом не меняется: `node wrap.js`, затем коммит `index.html`+`version.json` в `deploy/` (клон `main`).
