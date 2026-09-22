# Wii — план реализации

Статусы:

- `[x]` — выполнено и проверено
- `[ ]` — не выполнено или требует проверки
- `[-]` — выполняется

Актуализация по исходникам: приоритет 0 исправлен в коде и прошел автоматические проверки, но живой WebView/reload не проверен. Фазы 1–2 реализованы в коде, включая пункт 2.6 (`models.json`); ручные acceptance criteria ещё не проверены. Фазы 3–5 не завершены; сквозная проверка фазы 6 и ручные сценарии требуют выполнения. Успешная сборка не подтверждает ручные acceptance criteria.

## Порядок работ

0. Критический баг — исправлен в коде; осталось проверить живой WebView
0.1. Git — коммит `3058fb4`, fast-forward merge в `main` выполнены; последующие изменения dev/models/release ведутся в `main`
0.2. Release/dev — dev-изоляция и скрипты сборки/замены подготовлены; ручная проверка и публичный релиз не выполнены
1. Фаза 1 — Thinking и streaming в Timeline — реализовано; ручную проверку повторить
2. Фаза 2 — per-session provider/model и reasoning effort — реализовано; повторить ручную проверку
3. Фаза 3 — системный `HOME` для subprocess — не выполнено
4. Фаза 4 — decoupling плагинов от Wii Core — не выполнено
5. Фаза 5 — файловая конфигурация и storage плагинов — не выполнено
6. Фаза 6 — полная проверка — не выполнено

---

## Ближайшие шаги

1. [x] Аудит исходного diff, коммит `3058fb4`, fast-forward merge `feat/shadcn-migration` → `main`; последующие изменения dev/models/release — отдельный этап.
2. [x] Изолированы dev bundle ID/app data/`~/.wii-dev`/WebKit data; `Wii Dev.app` собран и запущен. Stable-каталоги не использовались; сравнение данных stable до/после и одновременный запуск обеих установок ещё проверить.
3. [ ] В изолированной dev-сборке проверить приоритет 0: использованная/пустая вкладка → закрытие → reopen → два reload → выход; сверить PID/PPID, число child на `.jsonl`, сохранность истории и ошибки WebView. При сбое исправить и повторить.
4. [x] Исправлена фаза 2.6: отдельные pi provider ID/keys/base URL для всех провайдеров, session provider ID, коллизии model ID; pi CLI показал оба одноимённых model ID. Ручные сценарии фаз 1–2 ещё проверить. Фазы 3–6 остаются отдельно.
5. [ ] Скрипты preview macOS arm64 и локальной замены stable подготовлены, **не запускались**: production release, подпись/notarization, проверка clean clone/backup/rollback и установка stable только после ручной интеграции.

---

## Git и macOS release/dev workflow

Статус: **Git-переход выполнен; dev-изоляция собрана; release/replace подготовлены, но не запущены**. Публичный релиз и замена stable требуют ручной интеграции, подписи/notarization и проверки backup/rollback.

### Git: переход на основную ветку

- [x] Основная ветка `main`; diff/untracked исходной ветки проверены, локальные секреты/временные файлы не обнаружены.
- [x] Исходное состояние закоммичено как `3058fb4` (включает намеренно bundled `pi` arm64); dev/models/release ведутся отдельным этапом.
- [x] Fast-forward merge в `main` выполнен, дальнейшая работа там. Публикация на GitHub отдельно после проверки релиза.

### Отдельная dev-версия на ноутбуке

- [x] `npm ci` → `npm run build:pi` → `npm run dev:app` / `npm run build:dev` документированы в `README.md`; dev `.app` собран.
- [-] Разные bundle identifier, имя, app data, `~/.wii-dev` и WebKit-каталог наблюдались в dev runtime. Проверка неизменности stable data и значений `localStorage` вручную остаётся.
- [-] Отдельные имя артефакта, окно и помеченная иконка dev готовы; одновременный запуск stable/dev не проверен.
- [ ] Проверить сценарий: установленный stable продолжает работать с прежними сессиями/плагинами/настройками до и после dev-запуска, dev-сборки и dev-обновления.

### Production release и установка stable

- [-] `scripts/build-macos-arm64.sh` готов: clean checkout, pinned npm/Cargo, bundled pi, тесты, app/DMG и проверка ресурсов. Отдельный unsigned stable `.app` успешно собран; полный скрипт и clean clone ещё не проверены.
- [ ] GitHub Release/скачивание DMG не выполнялись; README описывает macOS arm64, checksum и ограничения.
- [-] В README явно указан unsigned/unnotarized статус и Gatekeeper; подпись и notarization без Developer ID credentials не настроены.
- [-] `scripts/replace-stable.sh` готов: build до замены, typed confirmation, graceful quit, backup и rollback. **Не запускался** на установленной stable.
- [ ] Проверить сохранность app data, сессий, ключей и plugins при реальной замене stable; dev-данные не затрагивать. Совместимость форматов/миграций отдельно проверить.
- [ ] Проверить в чистом окружении: clone → dev-запуск; отдельные stable/dev установки; сборка macOS-артефакта → скачивание/запуск; локальная замена stable текущим билдом → сохранность данных и работающий rollback.

---

## Приоритет 0. Жизненный цикл процессов `pi`

Статус: **исправление внесено; автоматические проверки прошли, ручная интеграция ожидается**.

### Репорт

При закрытии использованных вкладок и повторных reload фронтенда наблюдались шесть оставшихся процессов `pi` под родителем `wii-harness` (PPID `46186`):

| PID | Время старта | Файл сессии | PPID |
|---|---|---|---|
| `46275` | 17:38:47 | `...18d7a2899dd99090-9.jsonl` | `46186` |
| `46310` | 17:38:47 | `...18d7a45841cc60e0-2.jsonl` | `46186` |
| `46582` | 17:42:49 | `...18d7a2899dd99090-9.jsonl` | `46186` |
| `46617` | 17:42:49 | `...18d7a45841cc60e0-2.jsonl` | `46186` |
| `46711` | 17:44:26 | `...18d7a2899dd99090-9.jsonl` | `46186` |
| `46746` | 17:44:26 | `...18d7a45841cc60e0-2.jsonl` | `46186` |

PID — снимок на момент репорта, не постоянные идентификаторы для очистки. Термин «зомби» здесь разговорный: состояние процессов (`Z` или живые фоновые workers) по исходникам не устанавливается; перед ручным завершением проверять состояние и командную строку актуальных PID. Автоматически применять `kill -9` к перечисленным PID нельзя.

### Причины исходного бага и внесенное исправление

- `src/store/session-store.ts`: раньше `closeTab()` вызывал `closeSession` только для нетронутой вкладки. Теперь останавливает каждый child до удаления вкладки из store; при ошибке сообщает пользователю и оставляет вкладку.
- `bootstrapApp()` восстанавливает вкладки из `wii_open_tabs`. Теперь сначала регистрирует новый экземпляр WebView; Rust останавливает процессы прежнего экземпляра только того же окна и запрещает второй child для уже открытого файла истории. Закрытие окна и выход из приложения также останавливают child.
- `close_session()` раньше удалял `.jsonl` по частичному совпадению ID. Теперь сохраняет использованную историю и удаляет только файл новой сессии без отправленных сообщений, если он пуст или содержит лишь заголовок. Поиск файла проверяет точный суффикс `-<session_id>.jsonl`.
- Проверено: `npm run test` (47), `cargo test` (2), `npm run build`, `cargo check --manifest-path src-tauri/Cargo.toml`, `git diff --check`. Живой reload, число процессов и файлов истории **не проверены**.

### Задачи

- [x] `closeTab()` останавливает backend-сессию при закрытии **любой** вкладки; история использованной сессии сохраняется для Session Manager/reopen.
- [x] Разделить в `close_session` остановку child и удаление истории: удалять только действительно пустой файл при подтвержденном сценарии неиспользованной сессии; не удалять историю по одному совпадению имени.
- [x] После закрытия убрать живую сессию из frontend store либо явно пометить закрытой: `openTab(resumePath)` не должен переключаться на скрытую вкладку и сохранять лишний процесс.
- [x] Не проглатывать ошибку `closeSession` молча; продумать откат/уведомление либо безопасную повторную очистку при сбое IPC.
- [x] На стороне Rust исключить несколько child для одного `resume_path`/файла истории, включая повторное открытие после reload; одного контроля совпадения генерируемого `session_id` недостаточно.
- [x] Определить владение процессами жизненным циклом WebView: при reload/HMR/F5 безопасно останавливать child прежнего экземпляра frontend либо переподключаться к нему; не убивать процессы другой активной WebView без проверки владения.
- [-] Добавить тесты закрытия использованной и пустой вкладок, reopen закрытой вкладки, сохранности `.jsonl`, двух последовательных reload и отсутствия дублирующих child на один файл. Unit-тесты закрытия/reopen и проверки пустого файла добавлены; reload/дедупликация требуют интеграционной проверки.
- [ ] Интеграционно проверить число процессов `pi` и файлов истории до/после закрытия вкладок, reload и выхода приложения.

---

## Фаза 1. Thinking и streaming сообщений в Timeline

Статус: **реализация выполнена; повторный browser smoke-test ожидается**.

### Типы и история

- [x] В `src/types/wii.ts` добавить в `MessageItem` поле `thinking?: string`.
- [x] Добавить transient-флаг `thinkingStreaming?: boolean` для управления авторазворачиванием UI.
- [x] В `src/lib/markdown.ts` добавить `extractMsgThinking(content)`.
- [x] `extractMsgText(content)` должен извлекать только блоки `type === "text"`.
- [x] `extractMsgThinking(content)` должен извлекать только блоки `type === "thinking"`.
- [x] При восстановлении `.jsonl` загружать `text`, `thinking` и `toolCall` блоки.
- [x] Добавить unit-тесты смешанного массива `thinking` / `text` / `toolCall`.

### RPC streaming

- [x] `message_start` создает отдельное assistant-сообщение с уникальным ID.
- [x] `thinking_start` подготавливает thinking-буфер.
- [x] `thinking_delta` иммутабельно добавляет delta.
- [x] `thinking_end` завершает thinking-stream.
- [x] `text_start`, `text_delta`, `text_end` собирают текстовый stream иммутабельно.
- [x] `message_end.message` считается авторитарным источником финальных `text`, `thinking`, `toolCalls`.
- [x] `agent_settled` сбрасывает `busy` и возвращает session в `idle`, если нет ошибки.

### UI

- [x] Thinking рендерится как Markdown.
- [x] Короткий однострочный thinking отображается без fold-контрола.
- [x] Длинный (`>160` символов) или реально многострочный thinking получает preview с `…` и fold-контрол.
- [x] Во время thinking-stream длинный блок автоматически раскрыт.
- [x] После завершения stream длинный блок автоматически сворачивается.
- [x] Thinking визуально темнее финального ответа.
- [x] Assistant message видим при пустом `text`, если есть `thinking` или `tools`.

### Проверка фазы

- [x] `npm run test` (текущий прогон: 44 теста успешно; после изменений повторить в фазе 6).
- [x] `npm run build` (текущий прогон успешен; после изменений повторить в фазе 6).
- [ ] Повторить browser runtime smoke-test без page errors после завершения изменений (предыдущий результат отмечен в истории плана, текущим аудитом не воспроизводился).

---

## Фаза 2. Per-session model и reasoning effort

Статус: **реализация выполнена, ручные acceptance criteria не подтверждены**. `models.json` теперь содержит все провайдеры; выбор provider/model сохраняется для каждой открытой вкладки.

Цель: смена модели или effort в одной вкладке не меняет остальные живые или восстановленные сессии.

### 2.1. Типы провайдера и сессии

Файлы:

- `src/types/wii.ts`
- `src-tauri/src/lib.rs`
- `src/lib/tauri.ts`

Задачи:

- [x] Удалить `model` и `reasoningEffort` из frontend `ProviderSettings`.
- [x] Удалить соответствующие поля из Rust-структур провайдера и input DTO.
- [x] Оставить у провайдера только:
  - `id: string`
  - `name: string`
  - `baseUrl: string`
  - `apiKey: string`
  - `models: string[]`
- [x] Сделать `models` обязательным массивом; при чтении старой конфигурации принимать отсутствие поля как `[]`.
- [x] Добавить в `SessionState`:
  - `model: string`
  - `reasoningEffort: string`
- [x] Добавить в Zustand store:
  - `lastUsedModel: string | null`
  - `lastUsedEffort: string | null`
- [x] Персистить последние значения в `localStorage` под отдельными ключами Wii.
- [x] Не хранить выбранную session model внутри provider config.

### 2.2. Выбор начальных значений новой сессии

Файл: `src/store/session-store.ts`.

- [x] Модель новой сессии выбирать в таком порядке:
  1. `lastUsedModel`, если модель доступна у активного провайдера;
  2. первая модель из `provider.models`;
  3. явная ошибка/блокировка создания, если список моделей пуст.
- [x] Effort новой сессии: `lastUsedEffort ?? "medium"`.
- [x] Передавать выбранные `model` и `reasoningEffort` в `tauri.createSession()`.
- [x] При восстановлении вкладки сохранять ее собственные model/effort, а не читать текущие глобальные значения провайдера.
- [x] Расширить `PersistedTab` полями `model` и `reasoningEffort`, чтобы reopen после рестарта не менял конфигурацию сессии.
- [x] Для старых persisted tabs без новых полей применить fallback новой сессии.

### 2.3. Frontend API и store actions

Файлы:

- `src/lib/tauri.ts`
- `src/store/session-store.ts`

- [x] Расширить `createSession` параметрами:
  - `model: string`
  - `reasoningEffort?: string | null`
- [x] Добавить wrappers:
  - `setSessionModel(sessionId, model)`
  - `setSessionThinking(sessionId, effort)`
- [x] Добавить store actions:
  - `setActiveSessionModel(model)`
  - `setActiveSessionReasoningEffort(effort)`
- [x] Store action сначала вызывает Tauri command; локальное состояние обновляется только после успешного IPC.
- [x] После успешной смены обновлять только выбранную сессию.
- [x] После успешной смены сохранять `lastUsedModel` / `lastUsedEffort`.
- [x] Ошибка IPC не должна молча показывать значение, которое subprocess не принял.
- [x] Обновить `getAllKnownModels()` и `getVisibleModels()`: активная session model должна оставаться видимой, даже если модель выключена фильтром.
- [x] Обновить расчет context limit и примерной стоимости: использовать `activeSession.model`, не provider model.
- [x] Обновить генерацию title: API-запрос должен использовать model текущей сессии.
- [x] Обновить browser-mode mock provider/session data под новую схему.

### 2.4. Composer

Файл: `src/components/layout/Composer.tsx`.

- [x] Model select получает value из `activeSession.model`.
- [x] Effort select получает value из `activeSession.reasoningEffort`.
- [x] Смена model вызывает `setActiveSessionModel`.
- [x] Смена effort вызывает `setActiveSessionReasoningEffort`.
- [x] Удалить запись model/effort через `saveCurrentProviderForm`.
- [x] При переключении вкладок оба select немедленно показывают значения выбранной сессии.
- [x] Пока IPC выполняется, не отправлять повторную конфликтующую смену.

### 2.5. Rust backend и pi RPC

Файл: `src-tauri/src/lib.rs`.

- [x] `create_session` принимает:
  - `model: String`
  - `reasoning_effort: Option<String>`
- [x] `spawn_session` принимает те же значения и не читает model/effort из provider config.
- [x] Запуск `pi` получает per-session аргументы:
  - `--model <model>`
  - `--thinking <effort>`
- [x] Добавить Tauri command `set_session_model(session_id, model)`.
- [x] Command отправляет живому RPC process:
  - `{"type":"set_model","provider":"wii-openai","modelId":"..."}`
- [x] Добавить Tauri command `set_session_thinking(session_id, effort)`.
- [x] Command отправляет:
  - `{"type":"set_thinking_level","level":"..."}`
- [x] Проверять существование session ID и возвращать IPC error, если процесс отсутствует.
- [x] Не менять конфигурацию других процессов.
- [x] Зарегистрировать обе команды в `generate_handler!`.

### 2.6. `models.json`

Файл: `src-tauri/src/lib.rs`.

- [x] `models.json` содержит все модели всех провайдеров; одинаковые model ID у разных provider ID не конфликтуют. Проверено Rust-тестом и `pi --list-models same-model`.
- [x] Каждый provider получает собственные `wii-<id>`, base URL и API key; сохранение/восстановление вкладки передаёт provider ID в pi CLI/RPC. `models.json` записывается атомарно с правами `0600`.
- [x] Записывать флаг поддержки reasoning для моделей Wii.
- [x] Не использовать model/effort как глобальное поле provider config.
- [x] После сохранения провайдеров атомарно обновлять `models.json` (temp → rename; пока только данные активного провайдера).

### 2.7. Providers panel

Файл: `src/components/modals/command-center/ProvidersPanel.tsx`.

- [x] Удалить глобальные inputs выбранной model и reasoning effort.
- [x] Оставить:
  - provider name
  - base URL
  - API key
  - список доступных моделей
  - enable/disable фильтр моделей, если он остается частью UX
- [x] Сохранение provider form не должно менять ни одну живую сессию.

### Acceptance criteria фазы 2

Ранее отмечены выполненными; текущая проверка подтвердила кодовые пути и unit-тесты, но не запуск двух реальных процессов или рестарт приложения. Повторная интеграционная проверка обязательна, особенно после исправления жизненного цикла процессов.

- [ ] Открыть две сессии A и B.
- [ ] В A выбрать model X и effort `high`.
- [ ] В B выбрать model Y и effort `low`.
- [ ] Переключение вкладок показывает правильные независимые значения.
- [ ] Сообщения A обрабатываются model X/high, B — model Y/low.
- [ ] Изменение A не отправляет RPC в процесс B.
- [ ] После рестарта приложения обе восстановленные вкладки сохраняют свои значения.
- [ ] Новая сессия использует последнюю выбранную модель и effort.

---

## Фаза 3. Реальный `HOME` для subprocess

Статус: **не выполнено**. `spawn_session()` создает `<app_data_dir>/home`, передает его как `HOME`, вызывает `.env_clear()` и переопределяет `SHELL`.

Цель: bash/tools внутри pi видят пользовательское окружение, но данные самого pi остаются изолированы внутри Wii.

Файл: `src-tauri/src/lib.rs`.

### Задачи

- [ ] Удалить создание и использование `<app_data_dir>/home` как fake HOME.
- [ ] Не переопределять `HOME` при запуске subprocess либо явно передавать реальное системное значение без изменения.
- [ ] Не менять `USER`, `SHELL`, `PATH`, `SSH_AUTH_SOCK` и остальные пользовательские env без необходимости.
- [ ] Сохранить изоляцию pi через:
  - `PI_CODING_AGENT_DIR=<app_data_dir>/pi`
  - `PI_CODING_AGENT_SESSION_DIR=<app_data_dir>/sessions`
- [ ] Сохранить CLI flags:
  - `--session-dir <app_data_dir>/sessions`
  - `--no-skills`
  - `--no-extensions`
  - `--no-prompt-templates`
  - `--no-themes`
- [ ] Убедиться, что Wii не начинает читать пользовательские pi extensions/skills из `$HOME`.
- [ ] Не удалять hardware/environment calibration и пользовательский PATH.

### Acceptance criteria фазы 3

- [ ] Bash tool видит реальный `$HOME`.
- [ ] `git config --global --get ...` читает пользовательский `~/.gitconfig`.
- [ ] `ssh` видит `~/.ssh` и agent socket без копирования файлов в app data.
- [ ] Доступны пользовательские toolchains из PATH (`~/.cargo/bin`, nvm и т.п.).
- [ ] Wii sessions продолжают записываться только в app data sessions.
- [ ] Пользовательские global pi plugins/skills/templates/themes не подмешиваются.

---

## Фаза 4. Полный decoupling плагинов от Wii Core

Статус: **не выполнено**. В core остались `DEFAULT_PLUGINS`, `include_str!`, `.defaults-seeded`, исходники `src-tauri/default-plugins/` и seeding при startup/session spawn.

Цель: исходники и binary Wii не содержат встроенных plugin implementations.

### Удаление embedded plugins

- [ ] Удалить всю директорию `src-tauri/default-plugins/`, включая `caveman`, `ask_user`, `todo`, `websearch`, `webfetch`, `quota` и любые другие bundled plugins.
- [ ] Удалить Rust-константы/структуры `DEFAULT_PLUGINS` и все `include_str!` для plugin source.
- [ ] Удалить marker `.defaults-seeded` и логику его создания.
- [ ] Удалить функцию/ветку seeding default plugins.
- [ ] Удалить вызовы seeding из startup/session initialization.
- [ ] Проверить `rg "default-plugins|DEFAULT_PLUGINS|defaults-seeded|seed_default_plugins"`: совпадений в core быть не должно.

### External-only loading

Файлы:

- `src-tauri/src/lib.rs`
- `src/lib/plugins.ts`
- связанные plugin UI файлы

- [ ] Plugin source загружается только из `~/.wii/plugins/<plugin_id>/`.
- [ ] Пустая `~/.wii/plugins/` считается валидным состоянием: приложение работает без плагинов.
- [ ] Wii Core не знает ID, название, настройки или поведение конкретных плагинов.
- [ ] Generic plugin APIs (`list`, `delete`, runtime, UI protocol, storage) остаются generic.
- [ ] Не добавлять fallback plugin code в Rust/TypeScript.

### Acceptance criteria фазы 4

- [ ] Чистая установка запускается с нулем плагинов.
- [ ] Внешний plugin, вручную помещенный в `~/.wii/plugins/<id>/`, появляется после reload.
- [ ] Удаление внешнего plugin не приводит к его повторному созданию после restart.
- [ ] Сборка не содержит строк/исходников удаленных bundled plugins.

---

## Фаза 5. Файловая конфигурация и storage плагинов

Статус: **не выполнено**. `pluginConfig` и `ctx.storage` читают/пишут WebView `localStorage`; запланированных IPC-команд нет.

Цель: plugin state не зависит от WebView `localStorage`; все данные переживают смену WebView и управляются backend.

### 5.1. Файловая структура

Использовать app data directory Wii:

```text
<app_data_dir>/plugins/
├── config.json
└── data/
    ├── <plugin_id>.json
    └── ...
```

- [ ] `config.json` хранит enable/disable и settings каждого plugin.
- [ ] `data/<plugin_id>.json` хранит KV-объект `ctx.storage` конкретного plugin.
- [ ] Source plugins в `~/.wii/plugins/` не смешивать с config/data в app data.
- [ ] Создавать директории лениво при первом чтении/записи.
- [ ] Отсутствующий файл трактовать как пустой объект, не как ошибку.
- [ ] Поврежденный JSON возвращает понятную ошибку и не перезаписывается молча.
- [ ] Запись делать атомарно: temp file в той же директории → rename.
- [ ] Валидировать `plugin_id`: запрет `/`, `..`, path separators и выхода из `data/`.

### 5.2. Rust IPC

Файл: `src-tauri/src/lib.rs`.

Добавить команды:

- [ ] `get_plugins_config() -> JSON object`
- [ ] `save_plugins_config(config) -> Result<()>`
- [ ] `get_plugin_storage(plugin_id) -> JSON object`
- [ ] `set_plugin_storage(plugin_id, key, value) -> Result<()>`

Требования:

- [ ] Зарегистрировать команды в `generate_handler!`.
- [ ] `save_plugins_config` сохраняет весь config atomically.
- [ ] `set_plugin_storage` делает read-modify-write одного plugin-файла.
- [ ] `value` поддерживает любой JSON-compatible тип, включая `null`, arrays и objects.
- [ ] Значения разных plugin IDs физически разделены.
- [ ] IPC не принимает произвольный filesystem path от frontend.

### 5.3. Frontend wrappers

Файл: `src/lib/tauri.ts`.

- [ ] Добавить typed wrappers для четырех новых IPC commands.
- [ ] Для browser-only dev mode предоставить in-memory fallback, не `localStorage` production path.
- [ ] Ошибки backend не проглатывать в операциях записи.

### 5.4. Plugin config integration

Файлы:

- `src/store/session-store.ts`
- `src/lib/plugins.ts`
- plugin settings UI

- [ ] Удалить чтение `wii_plugins` из `localStorage`.
- [ ] Во время bootstrap загрузить config через `getPluginsConfig()` до вычисления effective system prompt и запуска plugin tools.
- [ ] `setPluginEnabled` сохраняет новый config через backend.
- [ ] `setPluginSetting` сохраняет новый config через backend.
- [ ] Локальный Zustand state обновлять только после успешной записи либо откатывать при ошибке.
- [ ] `deletePlugin` удаляет source plugin; отдельно удалить его config entry. Storage data не удалять без явного решения/действия пользователя.
- [ ] Удалить obsolete localStorage migration code после одноразовой миграции.

### 5.5. Миграция существующего `localStorage`

- [ ] При первом запуске новой версии прочитать старый `wii_plugins`, если backend config еще отсутствует/пуст.
- [ ] Валидный старый config один раз записать в `<app_data_dir>/plugins/config.json`.
- [ ] После подтвержденной backend-записи удалить старый `wii_plugins` key.
- [ ] Не перетирать уже существующий filesystem config данными из localStorage.
- [ ] Ошибка миграции не должна уничтожать старые данные.

### 5.6. `ctx.storage`

Файл: `src/lib/plugin-runtime.ts`.

- [ ] Удалить storage plugin data через WebView `localStorage`.
- [ ] При инициализации plugin runtime загрузить storage через `getPluginStorage(pluginId)`.
- [ ] `ctx.storage.get(key)` читает KV текущего plugin.
- [ ] `ctx.storage.set(key, value)` вызывает `setPluginStorage(pluginId, key, value)`.
- [ ] После успешной записи обновить runtime cache.
- [ ] Один plugin не может читать/писать storage другого plugin.
- [ ] Сохранить существующий публичный API `ctx.storage`, чтобы внешние plugins не переписывать.

### Acceptance criteria фазы 5

- [ ] Enable/disable и settings переживают полный restart приложения.
- [ ] `ctx.storage` переживает restart и очистку WebView storage.
- [ ] Два plugins с одинаковым key получают независимые значения.
- [ ] Поврежденный JSON дает контролируемую ошибку без потери файла.
- [ ] В production flow нет обращений к `localStorage` для plugin config/data.
- [ ] Existing localStorage config мигрируется ровно один раз.

---

## Фаза 6. Проверка, тесты и верификация

Статус: **автоматические проверки после приоритета 0 пройдены; остальное не выполнено**. `npm run test` — 47 тестов, `cargo test` — 2 теста, `npm run build`, `cargo check --manifest-path src-tauri/Cargo.toml`, `git diff --check` — успешно. Интеграция WebView и ручные сценарии не проверены.

### Автоматические проверки

- [ ] Добавить/обновить Vitest tests для:
  - history `text` / `thinking` parsing;
  - provider schema без global model/effort;
  - per-session store isolation;
  - persisted tab model/effort restore;
  - plugin config migration;
  - plugin runtime storage calls.
- [ ] Добавить минимальные Rust tests для:
  - безопасной валидации plugin ID;
  - чтения отсутствующего config/storage как `{}`;
  - atomic JSON persistence;
  - генерации `models.json` для нескольких моделей.
- [ ] После завершения изменений повторить `npm run test` (текущий прогон: 44 теста успешно).
- [ ] После завершения изменений повторить `cargo check --manifest-path src-tauri/Cargo.toml` (текущий прогон успешен).
- [ ] После завершения изменений повторить `npm run build` (текущий прогон успешен).
- [ ] После завершения изменений повторить `git diff --check` (текущий прогон успешен).

### Ручная интеграционная проверка

- [ ] Создать две одновременные сессии с разными model/effort.
- [ ] Отправить сообщения в обе и подтвердить независимый RPC state.
- [ ] Перезапустить приложение и проверить восстановление обеих вкладок.
- [ ] Проверить streaming thinking: короткий, длинный, markdown, tool call после thinking.
- [ ] Проверить реальный HOME через bash tool (`echo $HOME`, global git config, PATH).
- [ ] Проверить запуск без `~/.wii/plugins`.
- [ ] Установить один внешний plugin и проверить discovery/reload/delete.
- [ ] Проверить plugin config и `ctx.storage` после restart.
- [ ] Проверить одноразовую миграцию старого `wii_plugins`.
- [ ] Проверить закрытие использованных вкладок, reload/HMR/F5 и отсутствие оставшихся/дублирующих процессов `pi` при сохранении истории.

### Definition of done

- [ ] Все acceptance criteria фаз 2–5 выполнены.
- [ ] Нет TypeScript или Rust compile errors.
- [ ] Все tests проходят.
- [ ] Нет runtime page errors в WebView.
- [ ] В репозитории нет embedded plugin source.
- [ ] Model/effort нигде не хранится глобально в provider settings.
- [ ] Plugin config/data нигде не зависит от production WebView localStorage.
- [ ] Закрытие вкладок и reload WebView не оставляют лишних child-процессов и не удаляют историю использованных сессий.

---

## Ранее выполненные задачи

- [x] API key персистится в `provider.json` с правами `0600`; UI умеет показать/скрыть ключ.
- [x] Timeline поддерживает stick-to-bottom с сохранением ручного scroll вверх.
- [x] Composer отделен от scrollable Timeline.
- [x] Markdown renderer поддерживает headings, lists, code, links, emphasis и безопасное HTML escaping.
- [x] Tool calls отображаются компактными foldable-строками с цветными типами.
- [x] Применена темная нейтральная палитра Wii.
