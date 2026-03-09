import { request } from 'undici';
import { config } from '../config.js';

function toQueryString(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    usp.set(k, String(v));
  }
  return usp.toString();
}

// https://{HOST}{IATA_PATH}{airport}/{from}/{to}
export async function fetchAeroboxFlights({ airport, startAerobox, endAerobox, params }) {
  if (!config.AERODATABOX_API_KEY) {
    const err = new Error('Missing AERODATABOX_API_KEY in environment');
    err.statusCode = 500;
    throw err;
  }

  const baseUrl = `https://${config.AERODATABOX_API_HOST}`;
  const iataPath = config.AERODATABOX_API_IATA_PATH.startsWith('/')
    ? config.AERODATABOX_API_IATA_PATH
    : `/${config.AERODATABOX_API_IATA_PATH}`;

  const path = `${iataPath}${encodeURIComponent(airport)}/${startAerobox}/${endAerobox}`;

  const qs = toQueryString(params);
  const url = `${baseUrl}${path}${qs ? `?${qs}` : ''}`;

  const res = await request(url, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      'x-rapidapi-host': config.AERODATABOX_API_HOST,
      'x-rapidapi-key': config.AERODATABOX_API_KEY,
      accept: 'application/json'
    }
  });

  const text = await res.body.text();

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const err = new Error(`Upstream error (${res.statusCode})`);
    err.statusCode = 502;
    err.upstreamStatus = res.statusCode;
    err.upstreamBody = text.slice(0, 1500);
    err.upstreamUrl = url;
    throw err;
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const err = new Error('Upstream returned invalid JSON');
    err.statusCode = 502;
    err.upstreamStatus = res.statusCode;
    err.upstreamBody = text.slice(0, 1500);
    err.upstreamUrl = url;
    throw err;
  }
}
