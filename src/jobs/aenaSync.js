import { AIRPORTS } from '../aena/airports.js';
import { fetchAenaFlights, mapAenaItemToDb, todayYmdLocal, withinWindow } from '../aena/aena.js';
import { upsertFlightsFromAenaBatch, deleteNotMatchedAfterSync } from '../repositories/shuttleFlightsRepo.js';
import { config } from '../config.js';
import { sendMail } from '../mailer.js';

let AENA_SYNC_RUNNING = false;

async function asyncPool(limit, items, iteratorFn) {
  const ret = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);

    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(ret);
}

export async function runAenaSync({ logger }) {
  if (AENA_SYNC_RUNNING) {
    logger.warn('AENA sync already running');
    return { ok: false, error: 'AENA_SYNC_ALREADY_RUNNING' };
  }

  AENA_SYNC_RUNNING = true;

  try {
    const startedAt = new Date();
    const nowIso = startedAt.toISOString();
    const currentTs = Math.floor(startedAt.getTime() / 1000);
    const today = todayYmdLocal();

    // Window bounds for cleanup/reporting
    const startYmd = (() => {
      const [y, m, d] = today.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() - Math.abs(config.MAX_DAYS_PAST));
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    })();

    const endYmd = (() => {
      const [y, m, d] = today.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + Math.abs(config.MAX_DAYS_AHEAD));
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    })();

    const flightTypes = ['L', 'S'];
    const tasks = [];

    for (const airport of AIRPORTS) {
      for (const flightType of flightTypes) {
        tasks.push({ airport, flightType });
      }
    }

    const limit = Number.isFinite(config.CONCURRENCY) && config.CONCURRENCY > 0 ? config.CONCURRENCY : 6;

    let totalFetched = 0;
    let totalKept = 0;
    let totalUpserts = 0;
    let errors = 0;

    logger.info({ tasks: tasks.length, concurrency: limit }, 'Starting parallel AENA sync');

    const results = await asyncPool(limit, tasks, async ({ airport, flightType }) => {
      const { url, items } = await fetchAenaFlights({ airport, flightType, logger });
      totalFetched += items.length;

      const mapped = [];
      for (const it of items) {
        const f = mapAenaItemToDb(it, flightType);
        if (!f.compania || !f.numVuelo || !f.fecha || !f.horaProgramada) continue;
        if (!withinWindow(f.fecha, today, config.MAX_DAYS_PAST, config.MAX_DAYS_AHEAD)) continue;
        mapped.push(f);
      }

      totalKept += mapped.length;

      const CHUNK = 500;
      let upserts = 0;
      for (let i = 0; i < mapped.length; i += CHUNK) {
        const chunk = mapped.slice(i, i + CHUNK);
        const r = await upsertFlightsFromAenaBatch(chunk, currentTs);
        // affectedRows includes updates; we want logical records processed
        upserts += chunk.length;
      }

      totalUpserts += upserts;

      logger.info({ airport, flightType, fetched: items.length, kept: mapped.length, upserts, url }, 'AENA fetch+upsert ok');
      return { airport, flightType, fetched: items.length, kept: mapped.length, upserts };
    });

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        errors++;
        const { airport, flightType } = tasks[i];
        logger.error({ err: r.reason, airport, flightType }, 'AENA sync error');
      }
    }

    // Delete flights that were previously coming from AENA but are not present in this sync run.
    const deleted = await deleteNotMatchedAfterSync({ startYmd, endYmd, syncTs: currentTs });

    await sendMail(
      'AENA sync finalizado',
      `AENA sync finalizado\nFecha: ${nowIso}\nRango: ${startYmd}..${endYmd}\nFetched: ${totalFetched}\nKept(in window): ${totalKept}\nUpserts: ${totalUpserts}\nDeleted: ${deleted}\nErrors: ${errors}`,
      logger
    );

    return { ok: errors === 0, now: nowIso, range: { startYmd, endYmd }, fetched: totalFetched, kept: totalKept, upserts: totalUpserts, deleted, errors };
  } finally {
    AENA_SYNC_RUNNING = false;
  }
}
