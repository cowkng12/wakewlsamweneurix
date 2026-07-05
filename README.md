# NeurixHub Mini App

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
REQUIRED_CHANNEL_USERNAME=@NeurixHub
REQUIRED_CHANNEL_URL=https://t.me/NeurixHub
CRYPTO_PAY_TOKEN=токен_CryptoBot
SUPABASE_URL=https://ваш-проект.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key_из_Supabase
SUPABASE_STORE_KEY=neurixhub
ACCOUNT_DELIVERY_THRESHOLD=0.1
ACTIVATION_SITE_URL=https://ваш-render-url/activate
```

`VITE_API_BASE_URL` на Render можно не задавать: frontend использует тот же домен, с которого отдается сайт. Для локальной разработки в `.env.example` оставлен `http://localhost:3001`.

## Supabase

Supabase нужен, чтобы баланс, покупки, пополнения и ключи не пропадали после перезапуска Render.

```sql
create table if not exists app_store (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```

После создания таблицы добавьте `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` и `SUPABASE_STORE_KEY=neurixhub` в Render.
