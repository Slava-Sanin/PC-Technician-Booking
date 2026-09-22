# Заказ компьютерного техника

Book a Computer Technician / הזמנת טכנאי מחשבים

Платформа записи к компьютерному технику: динамический каталог услуг, расписание, несколько услуг в одной заявке, оплата и панель администратора. Backend — Supabase (PostgreSQL, Auth, Edge Functions). Отдельного Node/ASP.NET сервера нет.

## Architecture

Браузер отвечает только за интерфейс. Цены, длительность, доступность, роли, оплата, SMS и номера заявок считаются на сервере.

```text
React (Vite)
  → Edge Functions (anon key, verify_jwt = false)
    → PostgreSQL RPC (SECURITY DEFINER, service_role)
      → bookings, booking_services, payments, history
```

Публичные функции: `get-booking-config`, `get-service-catalog`, `get-availability`, `create-booking`.

Служебные: `payment-webhook` (подпись HMAC), `send-sms` (всегда 403: произвольная отправка из браузера закрыта). SMS уходит из `create-booking`, если в настройках включена отправка и заданы секреты Twilio.

Часовой пояс бизнеса: `Asia/Jerusalem`. Время хранится как `timestamptz`. Смещение `+02`/`+03` в коде не зашито.

## Database schema

Новые таблицы:

| Таблица | Назначение |
|---|---|
| `service_categories` | Категории RU/HE/EN, `active`, `archived_at`, порядок |
| `services` | Услуги, длительность, цена, режимы, политика оплаты |
| `booking_services` | Снимок названия, цены, длительности и количества |
| `working_hours` | Расписание по дням недели (0 = воскресенье) |
| `payment_methods` | Способы оплаты и тип интеграции |
| `service_payment_methods` | Какие способы разрешены у услуги |
| `payments` | Сумма, статус, id провайдера, без данных карты |
| `payment_webhook_events` | Идемпотентность webhook |
| `bank_transfer_profiles` | Реквизиты перевода, одна строка |

Расширены `bookings` (режим, устройство, суммы, `appointment_start`/`appointment_end`, `payment_status`, `payment_expires_at`), `booking_settings` (`slot_step_minutes`, `payment_hold_minutes`, `buffer_minutes`), `profiles` (`email`).

Статусы заявки: `new`, `pending_payment`, `confirmed`, `assigned`, `on_the_way`, `in_progress`, `waiting_for_parts`, `waiting_for_customer`, `completed`, `cancelled`, `no_show`, `payment_expired`. Поле `completed` остаётся и синхронизируется со статусом.

Занятый интервал: заявка не удалена, статус не `cancelled` / `payment_expired` / `no_show`, и удержание `pending_payment` ещё не истекло. Плюс `buffer_minutes` после конца визита.

## Service catalog

Каталог читается из PostgreSQL. Массив услуг в React не является источником правды. Изменение в админке видно клиенту без новой сборки фронтенда.

Публичная услуга видна, только если сама услуга и её категория активны и обе не в архиве. Выключение категории не меняет `service.active`.

Начальные категории: диагностика, новый компьютер, операционные системы, данные, сеть, периферия, безопасность, почта, программы, ремонт, удалённая помощь, обучение, умный дом (камеры, умные розетки, Home Assistant).

## Booking flow

Мастер: услуги → способ (выезд / удалённо / мастерская) → устройство → контакты → дата и время → оплата, если она нужна → подтверждение.

`create-booking` проверяет поля и вызывает `create_booking_atomic`. Функция берёт блокировку `pg_advisory_xact_lock`, пересчитывает цену и длительность из каталога и записывает снимок в `booking_services`. Цена и длительность из браузера не принимаются.

## Availability engine

`get-availability` принимает дату или месяц, id услуг и режим. Слот предлагается с шагом `slot_step_minutes`, если непрерывный интервал нужной длины помещается в рабочие часы и не пересекает занятые заявки. Отключённый день и дата из `disabled_dates` слотов не дают.

## RLS

`anon` не читает и не пишет `bookings`, каталог администратора, оплаты и историю. Обычный `authenticated` без роли в `profiles` тоже не читает заявки. `is_staff()` — чтение и обновление заявок. `is_admin()` — каталог, настройки, оплаты, роли. Физического удаления заявок в интерфейсе нет: используется `deleted_at`.

Роль из React не используется. Её читает PostgreSQL из `profiles`.

## Staff roles

Роли: `admin`, `technician`. Новые пользователи Auth не становятся администраторами. Последнего активного администратора нельзя снять через `admin_set_staff`.

## Payments

Способы: Bit, PayBox, Paysend, PayPal, Credit Card, Bank Transfer. Каждый можно выключить. Исторические платежи при этом остаются.

Политика услуги: `none`, `optional`, `required_before_booking`, `required_before_service`, `deposit`, `after_service`. Шаг оплаты в мастере появляется, если хотя бы у одной выбранной услуги политика `required_before_booking` или `deposit`, либо если политика `optional` и есть общий активный способ.

Типы интеграции: `manual`, `external_link`, `automatic`.

- Bit, PayBox, Paysend, банковский перевод: ручное подтверждение (`awaiting_verification`). Администратор подтверждает или отклоняет.
- PayPal: внешняя ссылка, без живого API, пока нет учётных данных продавца.
- Карта: hosted checkout. Пока не задан `CARD_CHECKOUT_SECRET`, карта не предлагается клиенту. Номер карты и CVV в базу не пишутся.

`pending_payment` держит слот `payment_hold_minutes` минут, затем статус становится `payment_expired` и слот освобождается.

Браузер не может пометить оплату как `paid`. Автоматический статус меняет только `apply_provider_payment` (роль `service_role`) после проверки подписи webhook.

## Payment methods

Глобальный флаг `payment_methods.active` и флаг `service_payment_methods.enabled` оба должны быть истинны. Архивный способ не показывается.

## SMS

Текст собирается на сервере после создания заявки. Ошибка Twilio не откатывает заявку: в ответе `smsSent: false`. Функция `send-sms` отклоняет вызовы.

## Timezone

`Asia/Jerusalem`, перевод даты и времени через PostgreSQL `AT TIME ZONE`. Переход на летнее время Израиля учитывается базой.

## Supabase migrations

Уже применённые файлы не изменяются. Новые изменения:

- `20260922040000_service_catalog_payments.sql` — каталог, оплаты, часы, поля заявок, начальные данные
- `20260922041000_catalog_booking_rpc.sql` — публичный каталог и доступность
- `20260922042000_atomic_booking_admin.sql` — атомарное создание заявки и аудит
- `20260922043000_admin_payments_grants.sql` — настройки, роли, разбор ручной оплаты, webhook

## Edge Functions

| Функция | Доступ |
|---|---|
| `get-booking-config` | публичные настройки, без персональных данных |
| `get-service-catalog` | активные категории и услуги |
| `get-availability` | слоты на дату или месяц |
| `create-booking` | проверка, заявка, оплата, SMS |
| `payment-webhook` | HMAC `x-payment-signature`, идемпотентность |
| `send-sms` | закрыта |

## Environment variables

В браузере только:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

## Supabase secrets

Задаются в панели Supabase, не в `VITE_*`:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
RATE_LIMIT_PEPPER
PAYMENT_WEBHOOK_SECRET
CARD_CHECKOUT_SECRET
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
```

`SUPABASE_SERVICE_ROLE_KEY` платформа подставляет в функции сама.

## Development

```bash
npm install
cp .env.example .env
npm run dev
npm test
npm run lint
npm run build
```

## Deployment

Фронтенд — статический хостинг (`npm run build`). Функции:

```bash
supabase functions deploy
```

Миграции:

```bash
supabase db push
```

Проект уже связан с Supabase. Пароль базы в CLI может не совпадать с сохранённым; применение через Management API с токеном CLI это обходит.

## Admin setup

Войдите через Supabase Auth. Учётная запись без строки в `profiles` видит «Недостаточно прав». Действующий администратор назначает техника или второго администратора в разделе «Техники». Реквизиты перевода заполняются в «Оплата → Банковские переводы».

## Testing

Vitest покрывает длительность нескольких услуг, сумму, формат валюты без зашитого символа, фильтр публичного каталога, фильтр способов оплаты, статусы, коды ошибок и проверку полей.

Два параллельных `create_booking_atomic` на один интервал: одна заявка создаётся, вторая получает `SLOT_UNAVAILABLE`.
