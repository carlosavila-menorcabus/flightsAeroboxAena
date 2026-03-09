import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);
const CURL_BIN = process.platform === 'win32' ? 'curl.exe' : 'curl';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildAenaUrl({ airport, flightType }) {
  return `${config.AENA_BASE}&airport=${encodeURIComponent(airport)}&flightType=${encodeURIComponent(flightType)}`;
}

function buildCurlArgs(url) {
  const connectTimeoutSec = Math.max(
    1,
    Math.round((Number(config.AENA_CONNECT_TIMEOUT_MS) || 8000) / 1000)
  );

  const maxTimeSec = Math.max(
    3,
    Math.round((Number(config.AENA_MAX_TIME_MS) || 25000) / 1000)
  );

  return [
    '-sS',
    '--compressed',
    '--connect-timeout',
    String(connectTimeoutSec),
    '--max-time',
    String(maxTimeSec),
    '-H',
    'Accept: application/json, text/plain, */*',
    '-H',
    'Accept-Language: es-ES,es;q=0.9,en;q=0.8',
    '-H',
    'Cache-Control: no-cache',
    '-H',
    'Pragma: no-cache',
    '-H',
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    '-H',
    'Referer: https://www.aena.es/',
    url
  ];
}

async function curlFetchText(url, logger) {
  const args = buildCurlArgs(url);

  const { stdout, stderr } = await execFileAsync(CURL_BIN, args, {
    windowsHide: true,
    maxBuffer: 50 * 1024 * 1024
  });

  const body = String(stdout ?? '').trim();

  if (!body) {
    const err = new Error('AENA empty response');
    err.meta = {
      url,
      stderr: String(stderr ?? '').slice(0, 1000)
    };
    throw err;
  }

  return body;
}

function looksLikeHtmlOrHttpError(body) {
  const s = String(body || '').trim().toLowerCase();
  return (
    s.startsWith('<!doctype html') ||
    s.startsWith('<html') ||
    s.includes('<body') ||
    s.startsWith('http/1.1 500') ||
    s.includes('internal server error')
  );
}

async function fetchAenaJsonWithRetry({ airport, flightType, logger }) {
  const url = buildAenaUrl({ airport, flightType });
  const retries = Number(config.AENA_RETRIES) || 5;

  for (let i = 0; i <= retries; i++) {
    try {
      const body = await curlFetchText(url, logger);

      if (looksLikeHtmlOrHttpError(body)) {
        const err = new Error(`AENA non-JSON/HTML error for ${airport}/${flightType}`);
        err.meta = { url, body: body.slice(0, 1000) };
        throw err;
      }

      let json;
      try {
        json = JSON.parse(body);
      } catch {
        const err = new Error(`AENA JSON parse error for ${airport}/${flightType}`);
        err.meta = { url, body: body.slice(0, 1000) };
        throw err;
      }

      if (!Array.isArray(json)) {
        const err = new Error(`AENA response not array for ${airport}/${flightType}`);
        err.meta = {
          url,
          body: JSON.stringify(json).slice(0, 1000)
        };
        throw err;
      }

      return { url, items: json };
    } catch (err) {
      const last = i === retries;
      const wait = 400 * Math.pow(2, i);

      logger?.warn?.(
        {
          airport,
          flightType,
          attempt: i + 1,
          retries: retries + 1,
          waitMs: wait,
          err: err?.message,
          meta: err?.meta
        },
        'AENA fetch retry'
      );

      if (last) throw err;
      await sleep(wait);
    }
  }

  throw new Error(`AENA fetch exhausted retries for ${airport}/${flightType}`);
}

export async function fetchAenaFlights({ airport, flightType, logger }) {
  return fetchAenaJsonWithRetry({ airport, flightType, logger });
}

export function parseDmyToYmd(dmy) {
  if (!dmy) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dmy).trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

export function todayYmdLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function mapAenaItemToDb(item, flightType) {
  function normalizeFlightNumber(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const digits = s.replace(/\D/g, '');
    return digits || s;
  }

  return {
    compania: item?.iataCompania ?? item?.compania ?? null,
    numVuelo: normalizeFlightNumber(item?.numVuelo),
    fecha: parseDmyToYmd(item?.fecha) ?? item?.fecha ?? null,
    horaProgramada: item?.horaProgramada ?? null,
    fechaEstimada: parseDmyToYmd(item?.fechaEstimada) ?? item?.fechaEstimada ?? null,
    horaEstimada: item?.horaEstimada ?? null,
    iataAena: item?.iataAena ?? null,
    iataOtro: item?.iataOtro ?? null,
    codigosCompania: item?.codigosCompania ?? null,
    iataCompania: item?.iataCompania ?? null,
    tipoVuelo: flightType,
    estado: item?.estado ?? null,
    nombreCompania: item?.nombreCompania ?? null
  };
}

export function withinWindow(dateYmd, todayYmd, pastDays, aheadDays) {
  if (!dateYmd || !todayYmd) return false;

  const [y, m, d] = String(dateYmd).split('-').map(Number);
  const [ty, tm, td] = String(todayYmd).split('-').map(Number);

  const date = new Date(y, m - 1, d);
  const today = new Date(ty, tm - 1, td);

  const min = new Date(today);
  min.setDate(min.getDate() - Number(pastDays || 0));

  const max = new Date(today);
  max.setDate(max.getDate() + Number(aheadDays || 0));

  return date >= min && date <= max;
}