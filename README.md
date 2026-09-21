# Система бронирования техников

Веб-приложение для бронирования выезда техника. Клиент выбирает дату и время, сервер атомарно проверяет слот и создаёт заявку. Админка работает через Supabase Auth и роли в PostgreSQL.

## Технологии

- Frontend: React 18, TypeScript, Vite, Tailwind CSS
- Backend: Supabase (PostgreSQL, Auth, Edge Functions)
- SMS: Twilio, только на сервере
- Языки интерфейса: русский, иврит (RTL), английский

## Architecture

```text
Customer
  React
    -> get-booking-config
    -> get-availability
    -> create-booking
         -> validation, rate limit
         -> create_booking_atomic
              -> booking_settings
              -> slot check + advisory lock
              -> insert bookings
              -> booking_history
         -> server SMS -> Twilio

Staff
  React Admin
    -> Supabase Auth
    -> profiles.role
    -> RLS: bookings, booking_settings, booking_history
```

Браузер не является доверенной средой. Правила расписания, часовой пояс, номер заявки, статус и SMS задаёт PostgreSQL или Edge Function.

## Security model

Анонимный клиент не может читать, создавать, менять или удалять строки `bookings` напрямую. Обычный authenticated-пользователь без активной роли `admin` или `technician` тоже не может.

Создание заявки доступно только через Edge Function `create-booking`. Она вызывает `create_booking_atomic` сервисной ролью. Функция сама проверяет поля, дату, рабочие часы, закрытые дни, интервал и дневной лимит.

`booking_number`, `status`, `technician_notes`, `deleted_at` и роль клиент передать не может: номер генерирует существующий database trigger, статус новой заявки всегда `new`.

Произвольная отправка SMS отключена. Старая функция `send-sms` больше не принимает телефон и текст: она отвечает `403`. Текст SMS собирает `create-booking` после успешного сохранения заявки.

## Booking flow

1. Клиент получает публичную конфигурацию расписания.
2. Выбирает дату.
3. Frontend запрашивает свободные слоты на эту дату.
4. Заполняет форму и вызывает `create-booking`.
5. PostgreSQL повторно проверяет слот под `pg_advisory_xact_lock`.
6. База генерирует `booking_number`.
7. Если SMS включены, сервер отправляет официальный текст.
8. Клиент видит номер заявки. Если SMS не ушло, заявка остаётся в базе, а интерфейс получает `smsSent: false`.

Если слот успели занять, сервер возвращает `SLOT_UNAVAILABLE`. Интерфейс показывает перевод и обновляет список слотов.

## RLS

Итог после новой миграции:

```text
                         anon   authenticated-no-role   technician   admin
bookings SELECT          DENY   DENY                    ALLOW        ALLOW
bookings INSERT          DENY   DENY                    DENY         DENY
bookings UPDATE          DENY   DENY                    ALLOW        ALLOW
bookings DELETE          DENY   DENY                    DENY         DENY
```

INSERT в `bookings` выполняет только `create_booking_atomic` от имени service role. Физический DELETE через API не выдаётся. Удаление в админке — это `deleted_at`.

`booking_history` читают только активные staff. Пишет её trigger, не браузер. `booking_rate_limits` клиентам недоступна. Настройки читает staff, меняет admin через `save_booking_settings`.

## Staff roles

Таблица `profiles`:

- `user_id` — ссылка на `auth.users`
- `role` — `admin` или `technician`
- `active`

Проверки `is_staff()` и `is_admin()` смотрят на `auth.uid()` и строку профиля. Роль из React не используется как доказательство прав.

Новая регистрация не создаёт профиль и не выдаёт права. Миграция один раз назначает `admin` тем пользователям, которые уже есть в `auth.users` в момент её применения. Пользователи, созданные позже, прав не получают, пока им явно не назначат роль.

## Booking settings

Источник правил — таблица `booking_settings` (одна строка) и `booking_disabled_dates`. Часовой пояс зафиксирован как `Asia/Jerusalem`. Интервал хранится в минутах: прежние 3 часа соответствуют 180 минутам.

`localStorage.bookingSettings` больше не является источником правды. Если ключ остался в браузере администратора, в настройках есть кнопка загрузки этих значений в форму. После сохранения на сервер ключ удаляется.

Публичный клиент получает только поля расписания через `get-booking-config`. Флаг `send_sms` наружу не отдаётся.

## Supabase Edge Functions

| Функция | Кто вызывает | Назначение |
| --- | --- | --- |
| `get-booking-config` | публичная форма | расписание без служебных полей |
| `get-availability` | публичная форма | свободные слоты или месяц, без персональных данных |
| `create-booking` | публичная форма | проверка, атомарное создание, официальное SMS |
| `send-sms` | никто в новом flow | всегда `403`, произвольный SMS relay закрыт |

Публичные функции нужно деплоить с `--no-verify-jwt`, потому что у клиента нет user JWT. Они не дают общего привилегированного API: `create-booking` принимает только поля заявки, сам назначает статус и номер и не принимает произвольный текст SMS.

## SMS flow

SMS уходит только после успешного INSERT. Текст зависит от `locale` (`ru`, `he`, `en`) и собирается на сервере. Ошибка Twilio не откатывает заявку. Ответ клиенту: `bookingCreated: true`, `smsSent: true|false`, `smsSkipped: true`, если отправка выключена в настройках.

## Timezone

В базе `appointment_date` — `timestamptz` (UTC). Клиент передаёт гражданские `appointmentDate` (`YYYY-MM-DD`) и `appointmentTime` (`HH:mm`). PostgreSQL интерпретирует их в `Asia/Jerusalem`, включая переход на летнее время. Смещения `+02:00` и `+03:00` в коде не зашиты.

## Database migrations

Старые файлы в `supabase/migrations` не изменялись. Новые:

1. `20260921120000_profiles_settings_status_history.sql` — роли, настройки, статус, история, индексы.
2. `20260921121000_rls_atomic_booking.sql` — закрытие старых политик, атомарное бронирование, rate limit.

Колонка `completed` сохранена как устаревшая совместимость. Источник состояния — `status`. Trigger держит `completed = (status = 'completed')`. Старые строки: `completed = true` → `completed`, иначе `new`.

Статусы: `new`, `confirmed`, `assigned`, `on_the_way`, `in_progress`, `completed`, `cancelled`, `no_show`.

Номер заявки по-прежнему генерирует существующий trigger `generate_booking_number`. Второй генератор не добавлялся. Ограничение уникальности сохранено.

Мягко удалённая заявка не занимает слот и не показывается в основном списке. В админке её можно открыть отдельно.

## Local development

Нужны Node.js 18+ и проект Supabase.

```bash
npm install
```

Файл `.env` в корне, только публичные ключи:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

```bash
npm run dev
npm run lint
npm test
npm run build
```

Приложение разработки: `http://localhost:5173`.

Локальный Supabase в этом репозитории не поднимался. Интеграционный тест гонки двух INSERT нужно выполнить вручную после применения миграций (сценарий ниже).

## Deployment

Миграции и функции в этой задаче не применялись к удалённой базе. Порядок для короткого окна обслуживания:

1. Убедиться, что секреты заданы.
2. Применить миграции.
3. Задеплоить функции. Пока функции не задеплоены, старая форма уже не сможет писать в `bookings` напрямую.
4. Опубликовать frontend.

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push
supabase functions deploy get-booking-config --no-verify-jwt
supabase functions deploy get-availability --no-verify-jwt
supabase functions deploy create-booking --no-verify-jwt
supabase functions deploy send-sms
```

Последняя команда обязательна: иначе в проекте может остаться прежняя публичная `send-sms`, которая отправляет произвольный текст.

## Required Supabase secrets

Задаются в Dashboard → Edge Functions → Secrets или через CLI. В репозиторий и в `VITE_*` их не кладут.

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `RATE_LIMIT_PEPPER` (необязателен; если его нет, для хеша источника используется сервисный ключ платформы)

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` платформа передаёт функциям сама. Сервисный ключ нельзя добавлять во frontend.

```bash
supabase secrets set TWILIO_ACCOUNT_SID=your_twilio_account_sid
supabase secrets set TWILIO_AUTH_TOKEN=your_twilio_auth_token
supabase secrets set TWILIO_PHONE_NUMBER=your_twilio_phone_number
supabase secrets set RATE_LIMIT_PEPPER=your_long_random_string
```

## Bootstrap first admin

Миграция копирует уже существующих `auth.users` в `profiles` с ролью `admin`. Это происходит один раз, в момент применения миграции, и не распространяется на будущие регистрации.

Проверка:

```sql
SELECT u.id, u.email, p.role, p.active
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
ORDER BY u.created_at;
```

Если нужный пользователь создан уже после миграции или остался без профиля, назначьте admin явно. Подставьте свой email:

```sql
INSERT INTO public.profiles (user_id, role, active)
SELECT id, 'admin', true
FROM auth.users
WHERE email = 'your-email@example.com'
ON CONFLICT (user_id) DO UPDATE
SET role = 'admin', active = true, updated_at = now();
```

Техника добавляют так же, с ролью `'technician'`. Снять права: `active = false` или удалить строку профиля. Пользователь останется в Auth, но заявки не увидит.

## Rate limit

На один нормализованный телефон: не чаще одной успешной заявки за 10 минут и не больше трёх за 24 часа. На источник запроса: не больше 20 обращений к созданию за час. В таблице хранится только хеш, не исходный IP. Записи старше 48 часов удаляются. Превышение даёт HTTP 429 и код `RATE_LIMITED`.

## Manual verification checklist

- Обычная заявка: свободный слот, в ответе есть `booking_number`, строка есть в админке со статусом «Новая».
- Занятый слот: второе бронирование того же времени возвращает `SLOT_UNAVAILABLE`, вторая строка не создаётся.
- Одновременное бронирование: два параллельных `create-booking` на одно и то же время. Ожидается один успех и один `SLOT_UNAVAILABLE`, не две строки. Пример после деплоя:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/create-booking" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"firstName\":\"A\",\"lastName\":\"One\",\"phone\":\"0501111111\",\"address\":\"Street 1\",\"city\":\"Haifa\",\"operatingSystem\":\"windows\",\"comments\":\"\",\"appointmentDate\":\"2026-10-20\",\"appointmentTime\":\"10:00\",\"locale\":\"en\"}" &
curl -s -X POST "$SUPABASE_URL/functions/v1/create-booking" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"firstName\":\"B\",\"lastName\":\"Two\",\"phone\":\"0502222222\",\"address\":\"Street 2\",\"city\":\"Haifa\",\"operatingSystem\":\"linux\",\"comments\":\"\",\"appointmentDate\":\"2026-10-20\",\"appointmentTime\":\"10:00\",\"locale\":\"en\"}" &
wait
```

Интервал по умолчанию 180 минут, поэтому конфликтуют и соседние слоты ближе трёх часов.

- Закрытая дата и закрытый день недели: календарь их блокирует, прямой вызов API возвращает `DISABLED_DATE` или `DISABLED_WEEKDAY`.
- Время вне рабочих часов или не на часовой сетке: `OUTSIDE_WORKING_HOURS`.
- Дневной лимит: `DAILY_LIMIT_REACHED`.
- Прошедшее время: `DATE_IN_PAST`.
- SMS включены и Twilio настроен: `smsSent: true`.
- SMS выключены или Twilio недоступен: заявка остаётся, `smsSent: false`.
- Вход без профиля или с `active = false`: «Недостаточно прав», список заявок не загружается.
- Technician: видит и редактирует заявки, настройки только для чтения.
- Admin: меняет статус, заметки, поля и настройки. Настройки после сохранения видны другому браузеру после обновления страницы.
- Мягкое удаление: заявки нет в основном списке, слот снова свободен, строка есть в «Показать удалённые» и в `booking_history`.
- RU, HE и EN: тексты переключаются. Для иврита у `html` атрибут `dir="rtl"`.
- Прямой `select`/`insert` в `bookings` анонимным ключом не возвращает и не создаёт строки.
- Вызов `send-sms` с любым телефоном и текстом возвращает 403 и ничего не отправляет.

## Возможные проблемы

Ошибка загрузки расписания значит, что миграции или `get-booking-config` ещё не задеплоены, либо в `.env` неверные `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.

Если администратор входит, но видит «Недостаточно прав», в `profiles` нет активной строки. Используйте SQL из раздела Bootstrap first admin.

SMS не отправляются, если не заданы секреты Twilio или функция `create-booking` не задеплоена. Заявка при этом должна сохраняться.
