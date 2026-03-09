import { config } from '../config.js';
import { compute12hWindow } from '../utils/timeWindow.js';
import { normalizeFlightNumber } from '../utils/flightNumber.js';
import { fetchAeroboxFlights } from '../aerobox/aeroboxClient.js';
import { getFlightsFromDatabaseTimeWindow, insertFlightsData } from '../repositories/shuttleFlightsRepo.js';

export function apiGuard(req, reply, done) {
  const ip = req.ip;

  if (config.ALLOW_LOCAL && (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.'))) {
    return done();
  }

  if (config.ALLOWED_IPS.length > 0 && !config.ALLOWED_IPS.includes(ip)) {
    reply.code(403).send({ ok: false, error: 'forbidden' });
    return;
  }

  // Soporta X-API-KEY o apiKey en query (compat)
  if (config.API_KEY) {
    const key = req.headers['x-api-key'] || req.query?.apiKey;
    if (key !== config.API_KEY) {
      reply.code(401).send({ ok: false, error: 'unauthorized' });
      return;
    }
  }

  done();
}

function normalizeFlightType(t) {
  const v = String(t || '').trim().toUpperCase();
  if (v === 'L' || v === 'S') return v;
  return null;
}

function typeFromDirection(direction) {
  const d = String(direction || '').trim().toLowerCase();
  if (d === 'arrival') return 'L';
  if (d === 'departure') return 'S';
  return null;
}

function parseAeroboxLocalToYmdTime(localStr) {
  // Aerobox: "2026-03-05 07:50+01:00" (con espacio)
  if (!localStr) return { date: null, time: null };

  const s = String(localStr).trim().replace(' ', 'T');
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return { date: null, time: null };

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');

  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}:00` };
}

export async function registerAeroboxFlightsRoutes(app) {
  // Public API (Laravel)
  app.get('/api/flights', { preHandler: apiGuard }, async (req, reply) => {
    const airport = String(req.query?.airport || '').trim().toUpperCase();

    // Compatibilidad: type=L/S o direction=Arrival/Departure
    let flightType = normalizeFlightType(req.query?.type || req.query?.flightType);
    if (!flightType && req.query?.direction) {
      flightType = typeFromDirection(req.query.direction);
    }

    if (!airport || !flightType) {
      return reply.code(400).send({ ok: false, error: 'airport and type are required' });
    }

    // Aerobox limita el rango a 12h, así que pedimos una fecha/hora de referencia.
    if (!req.query?.date) {
      return reply.code(400).send({
        ok: false,
        error: 'date is required (12h window). Use: ?airport=MAH&type=L&date=YYYY-MM-DDTHH:mm (or direction=Arrival/Departure)'
      });
    }

    const w = compute12hWindow(req.query.date);

    // 1) DB first
    const dbRows = await getFlightsFromDatabaseTimeWindow({
      airport,
      flightType,
      dayYmd: w.day,
      startTime: `${w.startHHmm}:00`,
      endTime: `${w.endHHmm}:59`,
      limit: req.query?.limit ?? 10000
    });

    if (dbRows.length > 0) {
      return { ok: true, source: 'db', count: dbRows.length, flights: dbRows };
    }

    // 2) Upstream Aerobox
    const upstream = await fetchAeroboxFlights({
      airport,
      startAerobox: w.startAerobox,
      endAerobox: w.endAerobox,
      params: {
        withLeg: 'true',
        direction: flightType === 'L' ? 'Arrival' : 'Departure'
      }
    });

    const list =
      flightType === 'L'
        ? (Array.isArray(upstream?.arrivals) ? upstream.arrivals : [])
        : (Array.isArray(upstream?.departures) ? upstream.departures : []);

    const mapped = list
      .map((f) => {
        const airline = f?.airline ?? {};

        const iataAena = airport;
        const iataOtro = flightType === 'L'
          ? (f?.departure?.airport?.iata ?? null)
          : (f?.arrival?.airport?.iata ?? null);

        const scheduledLocal = flightType === 'L'
          ? f?.arrival?.scheduledTime?.local
          : f?.departure?.scheduledTime?.local;

        const revisedLocal = flightType === 'L'
          ? f?.arrival?.revisedTime?.local
          : f?.departure?.revisedTime?.local;

        const s = parseAeroboxLocalToYmdTime(scheduledLocal);
        const r = parseAeroboxLocalToYmdTime(revisedLocal);

        const n = normalizeFlightNumber({
          iataCompania: airline?.iata ?? null,
          compania: airline?.icao ?? null,
          numVuelo: f?.number ?? null
        });

        return {
          compania: n.compania,
          numVuelo: n.numVuelo,
          fecha: s.date,
          horaProgramada: s.time,
          fechaEstimada: r.date,
          horaEstimada: r.time,
          iataAena,
          iataOtro,
          codigosCompania: null,
          iataCompania: n.iataCompania,
          tipoVuelo: flightType,
          estado: f?.status ?? null,
          nombreCompania: airline?.name ?? null,
          updated_timetamp: Math.floor(Date.now() / 1000)
        };
      })
      .filter((x) => x.compania && x.numVuelo && x.fecha && x.horaProgramada);

    if (mapped.length > 0) {
      await insertFlightsData(mapped);
    }

    const rows2 = await getFlightsFromDatabaseTimeWindow({
      airport,
      flightType,
      dayYmd: w.day,
      startTime: `${w.startHHmm}:00`,
      endTime: `${w.endHHmm}:59`,
      limit: req.query?.limit ?? 10000
    });

    return { ok: true, source: 'upstream', count: rows2.length, flights: rows2 };
  });
}
