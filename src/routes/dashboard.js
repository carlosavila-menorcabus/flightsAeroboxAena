import { config } from '../config.js';
import { AIRPORTS } from '../aena/airports.js';
import { compute12hWindow } from '../utils/timeWindow.js';
import { clampDaysAhead, ymdFromDate, addDays } from '../utils/dateLimit.js';
import { getFlightsFromDatabase } from '../repositories/shuttleFlightsRepo.js';
import { apiGuard } from './aeroboxFlights.js';

function dashboardGuard(req, reply, done) {
  if (config.DASHBOARD_PUBLIC) return done();
  return apiGuard(req, reply, done);
}

function normalizeFlightType(t) {
  const v = String(t || '').toUpperCase();
  if (v === 'L' || v === 'S') return v;
  return null;
}

function clampLimit(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 500;
  return Math.min(Math.floor(x), config.DASHBOARD_MAX_LIMIT);
}

function buildWindow(query) {
  // Prefer 12h window if `date` provided, else from/to, else today + daysAhead.
  if (query?.date) {
    const w = compute12hWindow(query.date);
    return {
      startYmd: w.day,
      endYmd: w.day,
      label: `${w.day} (12h)`
    };
  }

  const from = query?.from;
  const to = query?.to;
  if (from && to) {
    return {
      startYmd: String(from),
      endYmd: String(to),
      label: `${from}..${to}`
    };
  }

  const daysAhead = clampDaysAhead(query?.daysAhead ?? config.DASHBOARD_DEFAULT_DAYS_AHEAD, config.AERO_MAX_DAYS);
  const today = new Date();
  const startYmd = ymdFromDate(today);
  const endYmd = ymdFromDate(addDays(today, daysAhead));
  return { startYmd, endYmd, label: `${startYmd}..${endYmd}` };
}

async function fetchSnapshot({ airport, flightType, query }) {
  const win = buildWindow(query);
  const limit = clampLimit(query?.limit ?? 1000);
  const flights = await getFlightsFromDatabase({
    airport,
    flightType,
    startYmd: win.startYmd,
    endYmd: win.endYmd,
    limit
  });

  // Basic stats by status
  const stats = flights.reduce(
    (acc, f) => {
      const s = String(f?.estado || 'unknown').trim().toLowerCase() || 'unknown';
      acc.total += 1;
      acc.byStatus[s] = (acc.byStatus[s] || 0) + 1;
      if (f?.aenaVerificado) acc.verified += 1;
      if (f?.aenaVerificado === 0) acc.notVerified += 1;
      return acc;
    },
    { total: 0, verified: 0, notVerified: 0, byStatus: {} }
  );

  return { flights, rows: flights, window: win, limit, stats };
}

export async function registerDashboardRoutes(app) {
  if (!config.DASHBOARD_ENABLED) return;

  // Meta (airports + defaults)
  app.get('/api/dashboard/meta', { preHandler: dashboardGuard }, async () => {
    return {
      ok: true,
      airports: AIRPORTS,
      defaults: {
        airport: config.DASHBOARD_DEFAULT_AIRPORT,
        type: config.DASHBOARD_DEFAULT_TYPE,
        daysAhead: config.DASHBOARD_DEFAULT_DAYS_AHEAD,
        pushMs: config.DASHBOARD_PUSH_MS,
        wsPath: config.DASHBOARD_WS_PATH
      }
    };
  });

  // Snapshot over HTTP (Vue dashboard)
  async function httpSnapshot(req, reply) {
    const airport = String(req.query?.airport || config.DASHBOARD_DEFAULT_AIRPORT).trim().toUpperCase();
    const flightType = normalizeFlightType(req.query?.type || req.query?.flightType || config.DASHBOARD_DEFAULT_TYPE);
    if (!airport || !flightType) return reply.code(400).send({ ok: false, error: 'airport and type are required' });

    const snap = await fetchSnapshot({ airport, flightType, query: req.query });
    return { ok: true, source: 'db', airport, flightType, ...snap };
  }

  app.get('/api/dashboard/snapshot', { preHandler: dashboardGuard }, httpSnapshot);
  // Backwards compatibility
  app.get('/api/dashboard/flights', { preHandler: dashboardGuard }, httpSnapshot);

  // WebSocket feed
  app.get(config.DASHBOARD_WS_PATH, { websocket: true, preHandler: dashboardGuard }, (conn, req) => {
    const socket = conn?.socket || conn;
    const state = {
      airport: String(req.query?.airport || config.DASHBOARD_DEFAULT_AIRPORT).trim().toUpperCase(),
      flightType: normalizeFlightType(req.query?.type || req.query?.flightType || config.DASHBOARD_DEFAULT_TYPE) || 'L',
      query: { ...req.query }
    };

    let closed = false;

    const send = (obj) => {
      if (closed) return;
      try {
        socket?.send?.(JSON.stringify(obj));
      } catch {
        // ignore
      }
    };

    send({
      type: 'hello',
      ok: true,
      airports: AIRPORTS,
      defaults: {
        airport: config.DASHBOARD_DEFAULT_AIRPORT,
        type: config.DASHBOARD_DEFAULT_TYPE,
        daysAhead: config.DASHBOARD_DEFAULT_DAYS_AHEAD
      },
      wsPath: config.DASHBOARD_WS_PATH,
      pushMs: config.DASHBOARD_PUSH_MS
    });

    // Initial snapshot
    setImmediate(async () => {
      try {
        const snap = await fetchSnapshot({ airport: state.airport, flightType: state.flightType, query: state.query });
        send({ type: 'snapshot', airport: state.airport, flightType: state.flightType, ...snap });
      } catch (err) {
        send({ type: 'error', message: err?.message || String(err) });
      }
    });

    // Periodic refresh
    const timer = setInterval(async () => {
      try {
        const snap = await fetchSnapshot({ airport: state.airport, flightType: state.flightType, query: state.query });
        send({ type: 'snapshot', airport: state.airport, flightType: state.flightType, ...snap });
      } catch (err) {
        send({ type: 'error', message: err?.message || String(err) });
      }
    }, Math.max(1000, Number(config.DASHBOARD_PUSH_MS) || 5000));

    socket?.on?.('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw || ''));
      } catch {
        return;
      }

      if (msg?.action === 'subscribe') {
        const airport = String(msg?.airport || state.airport).trim().toUpperCase();
        const flightType = normalizeFlightType(msg?.type || msg?.flightType || state.flightType) || state.flightType;

        state.airport = airport;
        state.flightType = flightType;
        state.query = { ...state.query, ...(msg?.query || {}) };

        send({ type: 'subscribed', airport: state.airport, flightType: state.flightType, query: state.query });

        try {
          const snap = await fetchSnapshot({ airport: state.airport, flightType: state.flightType, query: state.query });
          send({ type: 'snapshot', airport: state.airport, flightType: state.flightType, ...snap });
        } catch (err) {
          send({ type: 'error', message: err?.message || String(err) });
        }
      }

      if (msg?.action === 'ping') {
        send({ type: 'pong', t: Date.now() });
      }
    });

    socket?.on?.('close', () => {
      closed = true;
      clearInterval(timer);
    });
  });
}
