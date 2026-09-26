# Подтверждение по email (без Resend и с Resend)

## Уже настроено на вашем проекте Supabase

- `VERIFICATION_LOG_CODES=true` — письма **не отправляются**, код виден в **логах** Edge Functions.
- `PUBLIC_SITE_URL=https://slava-sanin.github.io/PC-Technician-Booking` — ссылки в письмах регистрации.

### Как получить код при регистрации / заявке по email

1. В приложении нажмите «Отправить код» (канал **Email**).
2. Откройте [Supabase Dashboard](https://supabase.com/dashboard/project/kdhhbkzjibwuelytgroj/logs/edge-functions).
3. Раздел **Edge Functions** → **Logs**.
4. Выберите функцию `customer-auth` (регистрация) или `create-booking` (подтверждение заявки).
5. Найдите запись `verification_email_dev_mode` — в поле `body` будет текст вида `Код регистрации: 123456`.

Подтверждение по **SMS** работает через Twilio (секреты уже заданы) — код приходит на телефон как обычно.

---

## Когда понадобится Resend (настоящие письма)

Resend — сторонний сервис рассылки. Ключ **нельзя** выдать автоматически: нужен ваш аккаунт.

1. Зарегистрируйтесь на [resend.com](https://resend.com) (есть бесплатный тариф).
2. **API Keys** → Create API Key → скопируйте ключ `re_...`.
3. **Domains** → добавьте **свой** домен (где вы управляете DNS) и пропишите записи Resend.
   - **Нельзя** использовать `*@slava-sanin.github.io` или другой `*.github.io` в `VERIFICATION_EMAIL_FROM` — GitHub Pages не даёт DNS для почты, Resend вернёт `domain is not verified`.
   - `PUBLIC_SITE_URL` может быть GitHub Pages; это только ссылки в письмах, не адрес отправителя.
   - Для тестов без своего домена: `onboarding@resend.dev` (письма только на email владельца аккаунта Resend).
4. В терминале из корня проекта:

```powershell
supabase secrets set RESEND_API_KEY="re_ВАШ_КЛЮCH" VERIFICATION_EMAIL_FROM="onboarding@resend.dev"
supabase secrets unset VERIFICATION_LOG_CODES
supabase functions deploy customer-auth create-booking
```

После этого коды будут приходить на почту клиента, логи dev-режима можно отключить (`unset`).
