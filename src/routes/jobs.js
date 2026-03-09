import { config } from '../config.js';
import { runAenaSync } from '../jobs/aenaSync.js';
import { runAenaVerify } from '../jobs/aenaVerify.js';

function jobGuard(req, reply, done) {
  if (!config.JOB_TOKEN) return done();
  const h = req.headers['authorization'] || '';
  if (h !== `Bearer ${config.JOB_TOKEN}`) {
    reply.code(401).send({ ok: false, error: 'unauthorized' });
    return;
  }
  done();
}

export async function registerJobRoutes(app) {
  app.post('/jobs/aena/sync', { preHandler: jobGuard }, async (req, reply) => {
    const asyncMode = String(req.query?.async ?? '') === '1' || (req.raw?.url ?? '').includes('async=1');

    if (asyncMode) {
      setImmediate(() => runAenaSync({ logger: app.log }).catch((err) => app.log.error({ err }, 'AENA sync failed')));
      return reply.code(202).send({ ok: true, started: true, job: 'aena-sync' });
    }

    return await runAenaSync({ logger: app.log });
  });

  app.post('/jobs/aena/verify', { preHandler: jobGuard }, async (req, reply) => {
    const asyncMode = String(req.query?.async ?? '') === '1' || (req.raw?.url ?? '').includes('async=1');

    if (asyncMode) {
      setImmediate(() => runAenaVerify({ logger: app.log }).catch((err) => app.log.error({ err }, 'AENA verify failed')));
      return reply.code(202).send({ ok: true, started: true, job: 'aena-verify' });
    }

    return await runAenaVerify({ logger: app.log });
  });
}
