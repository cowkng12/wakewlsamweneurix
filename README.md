# NervaHub Mini App

Telegram Mini App для витрины AI-подписок, пополнения баланса, оплат и выдачи ключей активации.

## Локальный запуск

1. Установить зависимости:

```powershell
npm install
```

2. Создать `.env` из примера:

```powershell
copy .env.example .env
```

3. Заполнить `.env` и запустить backend с ботом:

```powershell
npm run dev:server
```

4. В отдельном окне запустить frontend:

```powershell
npm run dev
```

Локально frontend откроется на `http://localhost:5173`, backend на `http://localhost:3001`.

## Render

Проект нужно деплоить как `Web Service`, не как Static Site. Express-сервер отдает API, Telegram-бота и собранный frontend из `dist`.

Настройки Render:

```text
Build Command: npm install && npm run build
Start Command: npm start
Health Check Path: /health
```

В репозитории есть `render.yaml`, поэтому можно создать сервис через Blueprint. Секреты задаются в Render Environment, в код их добавлять не нужно.

Основные переменные окружения:

```text
TELEGRAM_BOT_TOKEN=токен_от_BotFather
ADMIN_CHAT_ID=ваш_telegram_id
WEB_APP_URL=https://ваш-render-url
SELLER_URL=https://t.me/metifrysell
REQUIRED_CHANNEL_USERNAME=@NervaHub
REQUIRED_CHANNEL_URL=https://t.me/NervaHub
CRYPTO_PAY_TOKEN=токен_CryptoBot
ACCOUNT_DELIVERY_THRESHOLD=0.1
ACTIVATION_SITE_URL=https://ваш-render-url/activate
```

`VITE_API_BASE_URL` на Render можно не задавать: frontend использует тот же домен, с которого отдается сайт. Для локальной разработки в `.env.example` оставлен `http://localhost:3001`.

## Supabase

Supabase нужен, чтобы баланс, покупки, пополнения и ключи не пропадали после перезапуска Render.
Без Supabase проект можно запускать для теста, но данные будут храниться во временном файле Render.

```sql
create table if not exists app_store (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```

После создания таблицы добавьте `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` и `SUPABASE_STORE_KEY=nervahub` в Render.

<!-- FACTORY_DOCS_START -->
## Генератор Новых Ботов

Генератор создает новый сайт-бот из этого шаблона, может залить его в GitHub, создать Render Web Service, проставить env/secrets и запустить deploy.

### Подготовка Файлов

Скопируйте config:

```powershell
copy factory\example.config.json factory\my-bot.json
```

Скопируйте локальный файл секретов:

```powershell
copy factory\example.env.example factory\my-bot.env
```

Настоящие токены пишите только в `factory\my-bot.env`. Этот файл игнорируется git.

### Что Заполнить В Config

В `factory\my-bot.json` поменяйте:

```json
"projectName": "MyBrand",
"folderName": "MyBrandSite",
"packageName": "mybrand-miniapp",
"storeKey": "mybrand",
"promoPrefix": "MYBRAND"
```

Поменяйте GitHub:

```json
"github": {
  "owner": "cowkng12",
  "repo": "mybrand-miniapp",
  "createRepo": true,
  "push": true,
  "visibility": "public"
}
```

Поменяйте Render:

```json
"render": {
  "serviceName": "mybrand-miniapp",
  "webAppUrl": "https://mybrand-miniapp.onrender.com",
  "region": "virginia",
  "plan": "free",
  "api": {
    "enabled": true,
    "apiKeyEnv": "RENDER_API_KEY",
    "deploy": true,
    "reuseExisting": true,
    "failOnMissingSecrets": true
  }
}
```

Поменяйте Telegram-канал:

```json
"telegram": {
  "channelUsername": "@MyBrand",
  "channelUrl": "https://t.me/MyBrand"
}
```

Для Supabase оставьте:

```json
"supabase": {
  "includeInRender": true
}
```

### Что Заполнить В Env

В `factory\my-bot.env`:

```text
RENDER_API_KEY=rnd_your_render_api_key
NEW_BOT_TELEGRAM_TOKEN=your_telegram_bot_token
ADMIN_CHAT_ID=your_telegram_id
CRYPTO_PAY_TOKEN=your_crypto_pay_token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

### Одна Команда Запуска

Из папки шаблона:

```powershell
cd C:\portfolio-sites\NeurixKeys
npm.cmd run launch:bot-site -- factory\my-bot.json
```

Если тестовую папку нужно перезаписать:

```powershell
npm.cmd run launch:bot-site -- factory\my-bot.json --force
```

Если env-файл лежит не там, где указан в config:

```powershell
npm.cmd run launch:bot-site -- factory\my-bot.json --env factory\other.env
```

### Supabase Вручную

1. Создайте проект на `supabase.com`.
2. Откройте `SQL Editor` и выполните:

```sql
create table if not exists app_store (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```

3. В `Project Settings` -> `API` возьмите `Project URL` и вставьте в `SUPABASE_URL`.
4. Там же возьмите `service_role key` и вставьте в `SUPABASE_SERVICE_ROLE_KEY`.

### Что Остается Вручную

1. Создать бота в `@BotFather`.
2. Получить `TELEGRAM_BOT_TOKEN` и вставить в `NEW_BOT_TELEGRAM_TOKEN`.
3. Получить `ADMIN_CHAT_ID`, например через `/myid` в уже запущенном боте или через любого ID-бота.
4. Получить `CRYPTO_PAY_TOKEN`, если нужны оплаты.
5. Получить `RENDER_API_KEY` в Render `Account Settings` -> `API Keys`.
6. Один раз авторизовать GitHub CLI:

```powershell
gh auth login
```

7. Если GitHub repo приватный, один раз подключить GitHub к Render в Dashboard.

Проверить Render API key можно так:

```powershell
Get-Content factory\my-bot.env | ForEach-Object { if ($_ -match '^([^#][^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process') } }
curl.exe -H "Authorization: Bearer $env:RENDER_API_KEY" https://api.render.com/v1/owners
```
<!-- FACTORY_DOCS_END -->
