import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { request } from 'undici';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGO_BASE = String(process.env.AIRLINE_LOGO_BASE || 'https://pics.avs.io').replace(/\/+$/, '');
const SIZE = Number(process.env.AIRLINE_LOGO_SIZE || 128);
const FALLBACK = process.env.AIRLINE_LOGO_FALLBACK || '/airlines/_unknown.png';

const publicDir = path.join(__dirname, '..', '..', 'public');
const airlinesDir = path.join(publicDir, 'airlines');

const inFlight = new Map();

function normalizeIata(iata) {
  return String(iata || '').trim().toUpperCase();
}

function localFilePath(code) {
  return path.join(airlinesDir, `${code}.png`);
}

function publicUrl(code) {
  return `/airlines/${encodeURIComponent(code)}.png`;
}

function remoteUrl(code) {
  return `${LOGO_BASE}/${SIZE}/${SIZE}/${encodeURIComponent(code)}.png`;
}

function ensureDirs() {
  if (!fs.existsSync(airlinesDir)) fs.mkdirSync(airlinesDir, { recursive: true });
}

async function downloadToLocal(code) {
  ensureDirs();

  const dest = localFilePath(code);
  if (fs.existsSync(dest)) return true;
  if (inFlight.has(code)) return inFlight.get(code);

  const p = (async () => {
    try {
      const res = await request(remoteUrl(code));
      if (res.statusCode !== 200) return false;

      const buf = Buffer.from(await res.body.arrayBuffer());
      if (buf.length < 64) return false;

      const tmp = `${dest}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      return true;
    } catch {
      return false;
    } finally {
      inFlight.delete(code);
    }
  })();

  inFlight.set(code, p);
  return p;
}

export async function getLogoUrlOrFetch(iata) {
  const code = normalizeIata(iata);
  if (!code) return FALLBACK;

  const dest = localFilePath(code);
  if (fs.existsSync(dest)) return publicUrl(code);

  const ok = await downloadToLocal(code);
  if (ok) return publicUrl(code);

  return FALLBACK;
}
