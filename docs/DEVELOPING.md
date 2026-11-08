# Как править и дополнять модуль

Сборки нет: правите файл, сохраняете, обновляете страницу Foundry (F5). Если менялся `module.json`
(языки, зависимости), полностью перезапустите сервер Foundry.

## Структура

| Путь | Что там |
|---|---|
| `scripts/main.js` | Точка входа: список блоков `BLOCKS`, настройки, резервная загрузка переводов. |
| `scripts/core/*.js` | По файлу на блок. В каждом функция `register()`, которую вызывает `main.js`. |
| `scripts/core/effects.js` | Эффекты (Оглушение, Продолжительный, Распластанность) и работа с Convenient Effects. |
| `scripts/utils/hooks.js` | `onChatRender`: хук отрисовки сообщения, отдающий jQuery (для кода, написанного под jQuery). |
| `scripts/utils/i18n.js` | `t("ключ")`: тексты из `lang/*.json`. |
| `lang/en.json`, `lang/ru.json` | Все надписи под ключом `FALLOUT_AUTO.*`. Наборы ключей в обоих файлах должны совпадать. |

## Новый блок

1. Создайте `scripts/core/мой-блок.js`:
   ```js
   export function register() {
       Hooks.on("updateActor", (actor, changes) => { /* ... */ });
   }
   ```
2. В `scripts/main.js` добавьте `import` и строку в `BLOCKS`.
3. Название и описание для настроек: ключи `FALLOUT_AUTO.settings.blocks.<id>.name` и `.hint` в обоих языковых файлах.

## Тексты

Не пишите русские или английские строки в коде: добавьте ключ в оба файла `lang/` и вызывайте `t("раздел.ключ")`
(в `damage.js` и `difficulty.js` он импортирован как `tr`, потому что там есть переменные с именем `t`).
Подстановки: `t("damage.armorDetail", { base: 3, ignore: 1 })` и `{base}` в тексте.

## Выпуск версии

1. Допишите `CHANGELOG.md`, поменяйте `version` в `module.json`.
2. На GitHub: Releases → Draft a new release → тег вида `v0.3.1` → Publish.
3. GitHub Actions (`.github/workflows/release.yml`) сам подставит ссылки в `module.json`, соберёт `module.zip`
   и приложит оба файла к релизу. Релиз НЕ помечайте как pre-release: ссылка `releases/latest` такие пропускает.
