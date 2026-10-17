import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

if (!process.env.SUPABASE_DB_PASSWORD?.trim()) {
  console.error(
    'SUPABASE_DB_PASSWORD is not set.\n'
    + 'Add it to .env.local (gitignored) — Supabase Dashboard → Project Settings → Database → password.\n'
    + 'Or run: $env:SUPABASE_DB_PASSWORD="..." ; npm run db:push',
  );
  process.exit(1);
}

const result = spawnSync('supabase', ['db', 'push', '--linked'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
