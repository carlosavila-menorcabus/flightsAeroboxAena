const el = (id) => document.getElementById(id);

const airportSel = el('airportSel');
const btnArr = el('btnArr');
const btnDep = el('btnDep');
const q = el('q');
const statusSel = el('statusSel');
const hideClosed = el('hideClosed');
const tbody = el('tbody');

const wsDot = el('wsDot');
const wsStatus = el('wsStatus');
const subtitle = el('subtitle');
const heroAirport = el('heroAirport');
const heroType = el('heroType');

const stTotal = el('stTotal');
const stVisible = el('stVisible');
const stWindow = el('stWindow');
const stRefresh = el('stRefresh');
const chips = el('chips');
const lastUpdate = el('lastUpdate');
const refreshBtn = el('refreshBtn');
const clock = el('clock');

let meta = null;
let ws = null;
let flights = [];

const STATUS_MAP = {
  BOR: { key: 'cerrado', label: 'Puerta cerrada', closed: true },
  CAN: { key: 'cancelado', label: 'Cancelado', closed: true },
  CER: { key: 'cerrado', label: 'Check-in cerrado', closed: true },
  EMB: { key: 'embarque', label: 'Embarcando', closed: false },
  FLY: { key: 'en-vuelo', label: 'En vuelo', closed: false },
  FNL: { key: 'cerrado', label: 'Finalizado', closed: true },
  HOR: { key: 'retrasado', label: 'Hora actualizada', closed: false },
  IBK: { key: 'en-proceso', label: 'En pista / bloque', closed: false },
  INI: { key: 'sin-confirmar', label: 'Pendiente de operación', closed: false },
  LND: { key: 'aterrizado', label: 'Aterrizado', closed: true },
  NPR: { key: 'sin-confirmar', label: 'No presentado', closed: true },
  RET: { key: 'retrasado', label: 'Retrasado', closed: false },
  SCH: { key: 'programado', label: 'Programado', closed: false },
  ULL: { key: 'ultima-llamada', label: 'Última llamada', closed: false },

  ARRIVED: { key: 'aterrizado', label: 'Aterrizado', closed: true },
  EXPECTED: { key: 'programado', label: 'Previsto', closed: false },
  DELAYED: { key: 'retrasado', label: 'Retrasado', closed: false },
  CANCELLED: { key: 'cancelado', label: 'Cancelado', closed: true },
  BOARDING: { key: 'embarque', label: 'Embarcando', closed: false },
  DEPARTED: { key: 'en-vuelo', label: 'Despegado', closed: true }
};

function safeStr(v) {
  return (v == null ? '' : String(v)).trim();
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtTime(v) {
  if (!v) return '—';
  return safeStr(v).slice(0, 5);
}

function normalizeStatus(code) {
  const raw = safeStr(code).toUpperCase();
  if (!raw) return { code: '', key: 'sin-confirmar', label: 'Sin confirmar', closed: false };
  return { code: raw, ...(STATUS_MAP[raw] || { key: 'sin-confirmar', label: raw, closed: false }) };
}

function parseMinutes(h) {
  const s = safeStr(h);
  if (!s || s.length < 5) return null;
  const hh = parseInt(s.slice(0, 2), 10);
  const mm = parseInt(s.slice(3, 5), 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function computeAenaDiffMinutes(f) {
  const base = f?.horaProgramada;
  const aena = f?.aenaHoraEstimada || f?.aenaHoraProgramada;

  const a = parseMinutes(aena);
  const b = parseMinutes(base);

  if (a == null || b == null) return null;
  return a - b;
}

function deltaHtml(f) {
  const d = computeAenaDiffMinutes(f);
  if (d == null || Math.abs(d) < 5) return '';

  let cls = 'mbd-delta';
  const abs = Math.abs(d);
  if (abs >= 30) cls += ' mbd-delta-high';
  else if (abs >= 10) cls += ' mbd-delta-med';
  else cls += ' mbd-delta-low';

  const txt = d > 0 ? `+${d} min` : `${d} min`;
  return `<div class="${cls}">${escapeHtml(txt)}</div>`;
}

function setType(type) {
  const arr = type === 'L';
  btnArr.classList.toggle('active', arr);
  btnDep.classList.toggle('active', !arr);
  heroType.textContent = arr ? 'Llegadas' : 'Salidas';
}

function currentType() {
  return btnArr.classList.contains('active') ? 'L' : 'S';
}

function updateHero() {
  heroAirport.textContent = airportSel.value || 'MAH';
  heroType.textContent = currentType() === 'L' ? 'Llegadas' : 'Salidas';
  subtitle.textContent = `${heroAirport.textContent} · ${heroType.textContent} · ${new Date().toLocaleString()}`;
}

function setWsState(mode) {
  wsDot.classList.remove('ok', 'bad');

  if (mode === 'online') {
    wsDot.classList.add('ok');
    wsStatus.textContent = 'online';
    return;
  }

  if (mode === 'offline') {
    wsDot.classList.add('bad');
    wsStatus.textContent = 'offline';
    return;
  }

  wsStatus.textContent = 'connecting...';
}

function flightLabel(f) {
  const num = safeStr(f.numVuelo);
  const iata = safeStr(f.iataCompania || f.compania);
  if (!iata) return num || '—';
  if (num.toUpperCase().startsWith(iata.toUpperCase())) return num;
  return `${iata} ${num}`.trim();
}

function routeLabel(f) {
  return currentType() === 'L'
    ? `Origen: ${safeStr(f.iataOtro) || '—'}`
    : `Destino: ${safeStr(f.iataOtro) || '—'}`;
}

function effectiveTimeMinutes(f) {
  const est = parseMinutes(f.aenaHoraEstimada || f.aenaHoraProgramada || f.horaEstimada);
  const prog = parseMinutes(f.horaProgramada);
  return est ?? prog ?? 9999;
}

function compareFlights(a, b) {
  const now = nowMinutes();

  const ta = effectiveTimeMinutes(a);
  const tb = effectiveTimeMinutes(b);

  const sa = normalizeStatus(a.aenaEstado || a.estado);
  const sb = normalizeStatus(b.aenaEstado || b.estado);

  const da = ta - now;
  const db = tb - now;

  const aPast = da < -90;
  const bPast = db < -90;

  if (aPast !== bPast) return aPast ? 1 : -1;

  const aPriority = sa.closed ? 1 : 0;
  const bPriority = sb.closed ? 1 : 0;
  if (aPriority !== bPriority) return aPriority - bPriority;

  const aAbs = Math.abs(da);
  const bAbs = Math.abs(db);
  if (aAbs !== bAbs) return aAbs - bAbs;

  return ta - tb;
}

function fillStatusSelect(rows) {
  const current = statusSel.value;
  const seen = Array.from(
    new Set(rows.map(r => normalizeStatus(r.aenaEstado || r.estado).code).filter(Boolean))
  ).sort();

  statusSel.innerHTML =
    `<option value="">Todos los estados</option>` +
    seen.map((code) => {
      const st = normalizeStatus(code);
      return `<option value="${escapeHtml(code)}">${escapeHtml(st.label)} · ${escapeHtml(code)}</option>`;
    }).join('');

  statusSel.value = seen.includes(current) ? current : '';
}

function renderChips(rows) {
  const counts = {};

  for (const f of rows) {
    const st = normalizeStatus(f.aenaEstado || f.estado);
    counts[st.code || 'EMPTY'] = (counts[st.code || 'EMPTY'] || 0) + 1;
  }

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  chips.innerHTML = entries.map(([code, count]) => {
    const st = normalizeStatus(code === 'EMPTY' ? '' : code);
    return `<button class="mbd-chip" data-status="${escapeHtml(code === 'EMPTY' ? '' : code)}"><span>${escapeHtml(st.label)}</span><b>${count}</b></button>`;
  }).join('');

  chips.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      statusSel.value = btn.getAttribute('data-status') || '';
      render();
    });
  });
}

function render() {
  const term = safeStr(q.value).toLowerCase();
  const statusFilter = safeStr(statusSel.value).toUpperCase();
  const hideClosedEnabled = !!hideClosed.checked;

  const rows = flights
    .filter((f) => {
      const st = normalizeStatus(f.aenaEstado || f.estado);

      if (statusFilter && st.code !== statusFilter) return false;
      if (hideClosedEnabled && st.closed) return false;

      if (!term) return true;

      const hay = [
        f.numVuelo,
        f.compania,
        f.iataCompania,
        f.nombreCompania,
        f.iataOtro,
        f.iataAena,
        f.estado,
        f.aenaEstado
      ].map(safeStr).join(' ').toLowerCase();

      return hay.includes(term);
    })
    .sort(compareFlights);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="mbd-empty">No hay vuelos para los filtros actuales.</td></tr>`;
    stTotal.textContent = String(flights.length || 0);
    stVisible.textContent = '0';
    return;
  }

  tbody.innerHTML = rows.map((f) => {
    const st = normalizeStatus(f.aenaEstado || f.estado);
    const estimated = fmtTime(f.aenaHoraEstimada || f.aenaHoraProgramada || f.horaEstimada);

    return `
      <tr class="${f.aenaVerificado ? 'ver' : ''}">
        <td class="mbd-mono"><strong>${escapeHtml(fmtTime(f.horaProgramada))}</strong></td>
        <td class="mbd-mono mbd-flight">${escapeHtml(flightLabel(f))}</td>
        <td>${escapeHtml(safeStr(f.nombreCompania) || safeStr(f.compania) || '—')}</td>
        <td class="mbd-route">${escapeHtml(routeLabel(f))}</td>
        <td><span class="mbd-state mbd-state-${escapeHtml(st.key)}">${escapeHtml(st.label)}</span></td>
        <td class="mbd-mono">
          <div class="mbd-est-main">${escapeHtml(estimated)}</div>
          ${deltaHtml(f)}
        </td>
      </tr>
    `;
  }).join('');

  stTotal.textContent = String(flights.length || 0);
  stVisible.textContent = String(rows.length || 0);
}

async function fetchMeta() {
  const res = await fetch('/api/dashboard/meta');
  const j = await res.json();
  if (!j?.ok) throw new Error('meta_failed');
  return j;
}

async function fetchSnapshot() {
  const airport = airportSel.value || meta?.defaults?.airport || 'MAH';
  const type = currentType();
  const params = new URLSearchParams({
    airport,
    type,
    daysAhead: String(meta?.defaults?.daysAhead ?? 3),
    limit: '2000'
  });

  const res = await fetch(`/api/dashboard/snapshot?${params.toString()}`);
  const j = await res.json();
  if (!j?.ok) throw new Error(j?.error || 'snapshot_failed');
  return j;
}

async function refreshSnapshot() {
  try {
    const snap = await fetchSnapshot();
    flights = Array.isArray(snap.rows) ? snap.rows : [];

    fillStatusSelect(flights);
    renderChips(flights);
    render();
    updateHero();

    stWindow.textContent = snap?.window?.label || '—';
    stRefresh.textContent = `Auto refresh: ${Math.floor((meta?.defaults?.pushMs || 5000) / 1000)}s`;
    lastUpdate.textContent = `Última actualización: ${new Date().toLocaleString()}`;
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="6" class="mbd-empty">Error cargando vuelos.</td></tr>`;
  }
}

function subscribe() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    action: 'subscribe',
    airport: airportSel.value,
    flightType: currentType(),
    daysAhead: meta?.defaults?.daysAhead ?? 3,
    limit: 2000
  }));
}

function connectWs() {
  if (ws) {
    try { ws.close(); } catch {}
  }

  setWsState('connecting');

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    setWsState('online');
    subscribe();
  });

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);

      if (msg?.type === 'snapshot') {
        flights = Array.isArray(msg.rows) ? msg.rows : [];
        fillStatusSelect(flights);
        renderChips(flights);
        render();
        updateHero();
        lastUpdate.textContent = `Última actualización: ${new Date().toLocaleString()}`;
      }

      if (msg?.type === 'pong') {
        setWsState('online');
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.addEventListener('close', () => {
    setWsState('offline');
    setTimeout(connectWs, 2500);
  });

  ws.addEventListener('error', () => {
    setWsState('offline');
  });
}

function tickClock() {
  clock.textContent = new Date().toLocaleTimeString();
}

btnArr.addEventListener('click', () => {
  setType('L');
  updateHero();
  refreshSnapshot();
  subscribe();
});

btnDep.addEventListener('click', () => {
  setType('S');
  updateHero();
  refreshSnapshot();
  subscribe();
});

airportSel.addEventListener('change', () => {
  updateHero();
  refreshSnapshot();
  subscribe();
});

q.addEventListener('input', render);
statusSel.addEventListener('change', render);
hideClosed.addEventListener('change', render);
refreshBtn.addEventListener('click', refreshSnapshot);

(async function init() {
  tickClock();
  setInterval(tickClock, 1000);

  meta = await fetchMeta();

  airportSel.innerHTML = (meta.airports || []).map((a) =>
    `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`
  ).join('');

  airportSel.value = meta?.defaults?.airport || 'MAH';
  setType(meta?.defaults?.type || 'L');
  updateHero();

  await refreshSnapshot();
  connectWs();

  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: 'ping' }));
    }
  }, 15000);
})();