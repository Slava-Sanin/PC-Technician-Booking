# Система бронирования техников

Веб-приложение для бронирования выезда техника для установки операционных систем.

## Технологии

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth)
- **SMS**: Twilio
- **Интернационализация**: i18next (RU/EN/HE)

## Требования

- Node.js 18+ 
- npm или yarn
- Аккаунт Supabase
- Аккаунт Twilio (опционально, для SMS)

## Установка

1. **Клонируйте репозиторий** (если еще не сделано)

2. **Установите зависимости:**
```bash
npm install
```

3. **Настройте переменные окружения для клиента:**

Создайте файл `.env` в корне проекта:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**Где взять эти значения:**

- **Supabase**: 
  - Перейдите в ваш проект на [supabase.com](https://supabase.com)
  - Settings → API
  - Скопируйте `Project URL` и `anon public` ключ

**⚠️ ВАЖНО:** Ключи Twilio НЕ должны быть в `.env` файле клиента! Они настраиваются отдельно в Supabase Secrets для Edge Functions (см. шаг 5).

4. **Настройте базу данных Supabase:**

Примените миграции из папки `supabase/migrations`:

- В Supabase Dashboard перейдите в SQL Editor
- Примените все миграции по порядку (от старых к новым):
  1. `20250218192320_teal_hill.sql`
  2. `20250219153825_autumn_hill.sql`
  3. `20250224192923_misty_lantern.sql`
  4. `20250225161454_smooth_oasis.sql`
  5. `20250225162153_wild_rain.sql`
  6. `20250226153931_sparkling_ember.sql`
  7. `20250226174742_violet_flower.sql`

**Или используйте Supabase CLI** (рекомендуется для автоматического применения):

**Установка Supabase CLI на Windows:**

Вариант 1: Через Scoop (рекомендуется)
```powershell
# Установите Scoop (если еще не установлен)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression

# Установите Supabase CLI
scoop install supabase
```

Вариант 2: Через npx (без установки)
```bash
# Используйте npx для запуска без установки
npx supabase db push
```

Вариант 3: Скачать бинарник напрямую
1. Перейдите на https://github.com/supabase/cli/releases
2. Скачайте `supabase_X.X.X_windows_amd64.zip`
3. Распакуйте и добавьте в PATH

После установки CLI:
```bash
# Войдите в Supabase
supabase login

# Свяжите проект
supabase link --project-ref your-project-ref

# Примените все миграции
supabase db push
```

5. **Настройте Supabase Edge Function для SMS** (обязательно для отправки SMS):

SMS отправляются через Supabase Edge Functions для безопасности (ключи Twilio хранятся на сервере, а не в клиентском коде).

**Где взять ключи Twilio:**
- Зарегистрируйтесь на [twilio.com](https://www.twilio.com)
- Dashboard → Account Info
- Скопируйте `Account SID` и `Auth Token`
- Получите номер телефона в Twilio Console → Phone Numbers → Manage → Active numbers

**Настройка Edge Function:**

```bash
# Свяжите проект (если еще не сделали)
supabase link --project-ref your-project-ref

# Установите переменные окружения для Edge Function (ключи Twilio хранятся здесь, а НЕ в .env!)
supabase secrets set TWILIO_ACCOUNT_SID=your_twilio_account_sid
supabase secrets set TWILIO_AUTH_TOKEN=your_twilio_auth_token
supabase secrets set TWILIO_PHONE_NUMBER=your_twilio_phone_number

# Деплой функции
supabase functions deploy send-sms
```

**Альтернатива через Supabase Dashboard:**
- Перейдите в ваш проект на [supabase.com](https://supabase.com)
- Settings → Edge Functions → Secrets
- Добавьте секреты: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

6. **Создайте пользователя для админ-панели:**

В Supabase Dashboard:
- Authentication → Users
- Add user → Create new user
- Укажите email и password (это будут учетные данные для входа в админ-панель)

## Запуск проекта

### Режим разработки

```bash
npm run dev
```

Приложение будет доступно по адресу: `http://localhost:5173`

### Сборка для продакшена

```bash
npm run build
```

Собранные файлы будут в папке `dist/`

### Просмотр продакшен-сборки

```bash
npm run preview
```

## Использование

### Для клиентов

1. Откройте приложение в браузере
2. Заполните форму бронирования:
   - Имя и фамилия
   - Номер телефона
   - Адрес
   - Выберите операционную систему
   - Выберите дату и время визита
3. Нажмите "Отправить заявку"
4. После успешного создания бронирования вы получите SMS с номером бронирования

### Для техников (админ-панель)

1. Нажмите на иконку гаечного ключа в правом верхнем углу
2. Войдите используя email и password, созданные в Supabase
3. В админ-панели вы можете:
   - Просматривать все бронирования
   - Отмечать бронирования как выполненные
   - Добавлять заметки техника
   - Удалять бронирования

## Структура проекта

```
project/
├── src/
│   ├── components/        # React компоненты
│   │   └── AdminView.tsx  # Админ-панель
│   ├── lib/               # Утилиты
│   │   ├── supabase.ts    # Клиент Supabase
│   │   └── twilioSender.ts # Отправка SMS
│   ├── i18n/              # Переводы
│   │   └── index.ts       # Конфигурация i18next
│   ├── App.tsx            # Главный компонент
│   └── main.tsx           # Точка входа
├── supabase/
│   ├── functions/         # Edge Functions
│   │   └── send-sms/      # Функция отправки SMS
│   └── migrations/        # Миграции БД
└── public/                # Статические файлы
```

## Возможные проблемы

### Ошибка подключения к Supabase

- Проверьте правильность `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` в `.env`
- Убедитесь, что файл `.env` находится в корне проекта
- Перезапустите dev-сервер после изменения `.env`

### SMS не отправляются

- **Проверьте, что Edge Function развернута:** `supabase functions deploy send-sms`
- **Проверьте секреты в Supabase:** Settings → Edge Functions → Secrets (должны быть `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`)
- Убедитесь, что номер телефона Twilio в формате `+1234567890`
- Проверьте баланс на аккаунте Twilio
- Проверьте логи Edge Function в Supabase Dashboard: Edge Functions → send-sms → Logs
- SMS отправка не блокирует создание бронирования - бронирование создастся даже если SMS не отправится

### Ошибки при применении миграций

- Применяйте миграции строго по порядку
- Если таблица уже существует, некоторые миграции могут пропустить создание (используется `IF NOT EXISTS`)

## Лицензия

Private project

