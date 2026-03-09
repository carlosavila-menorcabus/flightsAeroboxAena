import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import statik from '@fastify/static';
import websocket from '@fastify/websocket';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

import { config, assertConfig } from './config.js';
import { pingDb } from './db/pool.js';
import { mailEnabled } from './mailer.js';

import { registerAeroboxFlightsRoutes } from './routes/aeroboxFlights.js';
import { registerAirlinesRoutes } from './routes/airlines.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { runAenaSync } from './jobs/aenaSync.js';
import { runAenaVerify } from './jobs/aenaVerify.js';

assertConfig();

const app = Fastify({
  logger: true,
  trustProxy: config.TRUST_PROXY
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await app.register(helmet);
await app.register(formbody);
await app.register(sensible);
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

// WebSocket (dashboard)
await app.register(websocket);

// Static public assets (airline logos)
await app.register(statik, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
  decorateReply: true
});

// Routes
await registerAeroboxFlightsRoutes(app);
await registerAirlinesRoutes(app);
await registerJobRoutes(app);
await registerDashboardRoutes(app);

app.get('/health', async () => {
  const db = await pingDb().catch(() => false);
  return { ok: true, db };
});

app.get('/', async (req, reply) => {
  // Dashboard (airport-like screen)
  if (config.DASHBOARD_ENABLED) {
    return reply.type('text/html').sendFile('dashboard/index.html');
  }

  // Fallback JSON
  return {
    name: 'menorcabus-flights-service',
    endpoints: [
      '/health',
      'GET /api/flights',
      'GET /api/airlines/logo/:iata',
      'POST /jobs/aena/sync',
      'POST /jobs/aena/verify'
    ],
    tables: { shuttle_flights: config.TABLE_AEROBOX },
    scheduler: { enabled: config.ENABLE_SCHEDULER, aenaSync: config.CRON_AENA_SYNC, aenaVerify: config.CRON_AENA_VERIFY },
    concurrency: config.CONCURRENCY,
    mailEnabled: mailEnabled()
  };
});

if (config.ENABLE_SCHEDULER) {
  app.log.info({ aenaSync: config.CRON_AENA_SYNC, aenaVerify: config.CRON_AENA_VERIFY }, 'Scheduler enabled');

  cron.schedule(config.CRON_AENA_SYNC, async () => {
    try {
      app.log.info('Running scheduled AENA sync');
      await runAenaSync({ logger: app.log });
    } catch (err) {
      app.log.error({ err }, 'Scheduled AENA sync failed');
    }
  });

  cron.schedule(config.CRON_AENA_VERIFY, async () => {
    try {
      app.log.info('Running scheduled AENA verification');
      await runAenaVerify({ logger: app.log });
    } catch (err) {
      app.log.error({ err }, 'Scheduled AENA verify failed');
    }
  });
} else {
  app.log.info('Scheduler disabled (ENABLE_SCHEDULER=0). Use POST /jobs/aena/sync and /jobs/aena/verify or system cron.');
}

app.log.info({ mailEnabled: mailEnabled() }, 'Mail config');

const passengerPort = Number(process.env.PORT || config.PORT || 3015);
const passengerHost = process.env.HOST || config.HOST || '0.0.0.0';

await app.listen({ host: passengerHost, port: passengerPort });
