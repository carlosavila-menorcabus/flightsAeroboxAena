import 'dotenv/config';

function env(name, def = undefined) {
  const v = process.env[name];
  return (v === undefined || v === null || v === '') ? def : v;
}

export const config = {
  NODE_ENV: env('NODE_ENV', 'development'),

  HOST: env('HOST', '0.0.0.0'),
  PORT: Number(env('PORT', '3015')),
  TRUST_PROXY: String(env('TRUST_PROXY', '1')) === '1',

  // Security for public API (/api/*)
  API_KEY: env('API_KEY', ''),
  ALLOWED_IPS: (env('ALLOWED_IPS', '') || '').split(',').map(s => s.trim()).filter(Boolean),
  ALLOW_LOCAL: String(env('ALLOW_LOCAL', '1')) === '1',

  // Security for jobs (/jobs/*)
  JOB_TOKEN: env('JOB_TOKEN', ''),

  // DB
  DB_HOST: env('DB_HOST', '127.0.0.1'),
  DB_PORT: Number(env('DB_PORT', '3306')),
  DB_USER: env('DB_USER', 'root'),
  DB_PASS: env('DB_PASS', ''),
  DB_NAME: env('DB_NAME', ''),
  DB_CONN_LIMIT: Number(env('DB_CONN_LIMIT', '10')),

  // Tables
  TABLE_AEROBOX: env('TABLE_AEROBOX', 'shuttle_flights'),
  // NOTE: We now use a single table (TABLE_AEROBOX) for both Aerobox cache and AENA canonical data.

  // Aerobox (Aerodatabox / RapidAPI)
  AERODATABOX_API_HOST: env('AERODATABOX_API_HOST', 'aerodatabox.p.rapidapi.com'),
  AERODATABOX_API_KEY: env('AERODATABOX_API_KEY', ''),
  AERODATABOX_API_IATA_PATH: env('AERODATABOX_API_IATA_PATH', '/flights/airports/iata/'),
  AERO_MAX_DAYS: Number(env('AERO_MAX_DAYS', '210')),

  // AENA
  AENA_BASE: env('AENA_BASE', 'https://www.aena.es/sites/Satellite?pagename=AENA_ConsultarVuelos'),
  REQUEST_TIMEOUT_MS: Number(env('REQUEST_TIMEOUT_MS', '20000')),
  CONCURRENCY: Number(env('CONCURRENCY', '6')),
  MAX_DAYS_PAST: Number(env('MAX_DAYS_PAST', '1')),
  MAX_DAYS_AHEAD: Number(env('MAX_DAYS_AHEAD', '2')),

  // Verification job
  VERIFY_EVERY_MINUTES: Number(env('VERIFY_EVERY_MINUTES', '10')),
  VERIFY_STALE_MINUTES: Number(env('VERIFY_STALE_MINUTES', '15')),
  VERIFY_LOOKAROUND_MINUTES: Number(env('VERIFY_LOOKAROUND_MINUTES', '180')),

  // Scheduler
  ENABLE_SCHEDULER: String(env('ENABLE_SCHEDULER', '0')) === '1',
  CRON_AENA_SYNC: env('CRON_AENA_SYNC', '*/10 * * * *'),
  CRON_AENA_VERIFY: env('CRON_AENA_VERIFY', '*/10 * * * *'),

  // Dashboard (real-time)
  DASHBOARD_ENABLED: String(env('DASHBOARD_ENABLED', '1')) === '1',
  DASHBOARD_PUBLIC: String(env('DASHBOARD_PUBLIC', '0')) === '1',
  DASHBOARD_WS_PATH: env('DASHBOARD_WS_PATH', '/ws'),
  DASHBOARD_PUSH_MS: Number(env('DASHBOARD_PUSH_MS', '5000')),
  DASHBOARD_DEFAULT_AIRPORT: env('DASHBOARD_DEFAULT_AIRPORT', 'MAH'),
  DASHBOARD_DEFAULT_TYPE: env('DASHBOARD_DEFAULT_TYPE', 'L'),
  DASHBOARD_DEFAULT_DAYS_AHEAD: Number(env('DASHBOARD_DEFAULT_DAYS_AHEAD', '0')),
  DASHBOARD_MAX_LIMIT: Number(env('DASHBOARD_MAX_LIMIT', '2000')),

  // Mail
  MAIL_ENABLED: String(env('MAIL_ENABLED', '0')) === '1',
  MAIL_TO: env('MAIL_TO', ''),
  SMTP_HOST: env('SMTP_HOST', ''),
  SMTP_PORT: Number(env('SMTP_PORT', '587')),
  SMTP_USER: env('SMTP_USER', ''),
  SMTP_PASS: env('SMTP_PASS', ''),
  SMTP_SECURE: String(env('SMTP_SECURE', '0')) === '1',
  SMTP_IGNORE_TLS: String(env('SMTP_IGNORE_TLS', '0')) === '1',
  SMTP_TLS_REJECT_UNAUTHORIZED: String(env('SMTP_TLS_REJECT_UNAUTHORIZED', '1')) === '1'
};

export function assertConfig() {
  if (!config.DB_NAME) throw new Error('Missing DB_NAME');
}
