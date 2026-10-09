# Acceptance criteria

## Supabase Keep-Alive

- [x] создан `public.keep_alive()`
- [x] функция применена в remote Supabase
- [x] anon RPC request протестирован
- [x] service role не используется
- [x] создан `.github/workflows/supabase-keep-alive.yml`
- [x] используется `VITE_SUPABASE_URL`
- [x] используется `VITE_SUPABASE_ANON_KEY`
- [x] secrets не выводятся в logs
- [x] workflow запускается каждые 8 часов (`17 */8 * * *`)
- [x] `workflow_dispatch` присутствует
- [ ] GitHub Action проверен на remote (после push в default branch)
- [x] README описывает механизм
- [x] documented GitHub scheduled-workflow inactivity caveat
