import { createApp, computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue';
import './style.css';
import logoUrl from './logoblack.png';

const STATUS_MAP = {
  BOR: { label: 'Boarding', cls: 'b-blue' },
  CAN: { label: 'Cancelado', cls: 'b-red' },
  CER: { label: 'Cerrado', cls: 'b-slate' },
  EMB: { label: 'Embarque', cls: 'b-cyan' },
  FLY: { label: 'En vuelo', cls: 'b-sky' },
  FNL: { label: 'Finalizado', cls: 'b-slate' },
  HOR: { label: 'Hora prevista', cls: 'b-amber' },
  IBK: { label: 'En bloque', cls: 'b-violet' },
  INI: { label: 'Inicial', cls: 'b-indigo' },
  LND: { label: 'Aterrizado', cls: 'b-green' },
  NPR: { label: 'No presentado', cls: 'b-red' },
  RET: { label: 'Retrasado', cls: 'b-amber' },
  SCH: { label: 'Programado', cls: 'b-blue' },
  ULL: { label: 'Última llamada', cls: 'b-orange' },

  ARRIVED: { label: 'Llegado', cls: 'b-green' },
  EXPECTED: { label: 'Previsto', cls: 'b-blue' },
  DELAYED: { label: 'Retrasado', cls: 'b-amber' },
  CANCELLED: { label: 'Cancelado', cls: 'b-red' },
  BOARDING: { label: 'Boarding', cls: 'b-cyan' },
  DEPARTED: { label: 'Salido', cls: 'b-sky' },
  LANDED: { label: 'Aterrizado', cls: 'b-green' },
  UNKNOWN: { label: 'Sin estado', cls: 'b-slate' }
};

function fmtTime(t) {
  if (!t) return '—';
  return String(t).slice(0, 5);
}

function safeStr(v) {
  return (v == null ? '' : String(v)).trim();
}

function normStatus(s) {
  const raw = safeStr(s).toUpperCase();
  if (!raw) return 'UNKNOWN';
  return raw;
}

function statusMeta(s) {
  const code = normStatus(s);
  return STATUS_MAP[code] || { label: code, cls: 'b-slate' };
}

function minutesDelta(h1, h2) {
  const a = safeStr(h1);
  const b = safeStr(h2);
  if (!a || !b) return null;

  const pa = a.split(':').map(Number);
  const pb = b.split(':').map(Number);
  if (pa.length < 2 || pb.length < 2) return null;

  const ma = pa[0] * 60 + pa[1];
  const mb = pb[0] * 60 + pb[1];
  return mb - ma;
}

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function flightLabel(r) {
  const nv = safeStr(r.numVuelo);
  const pre = safeStr(r.iataCompania);
  if (!pre) return nv || '—';
  if (nv.toUpperCase().startsWith(pre.toUpperCase())) return nv;
  return `${pre} ${nv}`.trim();
}

function routeLabel(r, type) {
  return type === 'L'
    ? `Origen: ${safeStr(r.iataOtro) || '—'}`
    : `Destino: ${safeStr(r.iataOtro) || '—'}`;
}

function normalizeSnapshotPayload(j) {
  const rows =
    (Array.isArray(j?.rows) && j.rows) ||
    (Array.isArray(j?.flights) && j.flights) ||
    (Array.isArray(j?.items) && j.items) ||
    [];

  return {
    rows,
    now: j?.now || new Date().toISOString()
  };
}

const App = {
  setup() {
    const meta = reactive({
      ok: false,
      airports: [],
      defaults: {
        airport: 'MAH',
        type: 'L',
        daysAhead: 3,
        pushMs: 5000,
        wsPath: '/ws',
        max: 2000
      },
      server: {
        name: 'menorcabus-flights-service',
        version: '',
        now: ''
      }
    });

    const state = reactive({
      connected: false,
      lastUpdate: null,
      airport: 'MAH',
      type: 'L',
      daysAhead: 3,
      search: '',
      status: 'ALL',
      aena: 'all',
      onlyDelta: false,
      limit: 300,
      sort: 'time',
      loading: true,
      error: null,
      rows: []
    });

    const ws = ref(null);
    const wsTimer = ref(null);

    const statusOptions = computed(() => {
      const codes = uniq(state.rows.map(r => normStatus(r.estado))).sort();
      return [
        { value: 'ALL', label: 'Todos los estados' },
        ...codes.map(code => ({
          value: code,
          label: `${statusMeta(code).label} · ${code}`
        }))
      ];
    });

    const summaryChips = computed(() => {
      const counts = {};
      for (const r of state.rows) {
        const code = normStatus(r.estado);
        counts[code] = (counts[code] || 0) + 1;
      }

      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => ({
          code,
          count,
          label: code.toLowerCase(),
          meta: statusMeta(code)
        }));
    });

    const filtered = computed(() => {
      const q = safeStr(state.search).toLowerCase();
      let rows = state.rows;

      if (state.status !== 'ALL') {
        rows = rows.filter(r => normStatus(r.estado) === state.status);
      }

      if (state.aena === 'yes') rows = rows.filter(r => !!r.aenaVerificado);
      if (state.aena === 'no') rows = rows.filter(r => !r.aenaVerificado);

      if (q) {
        rows = rows.filter(r => {
          const hay = [
            r.compania,
            r.iataCompania,
            r.nombreCompania,
            r.numVuelo,
            r.iataOtro,
            r.iataAena,
            r.estado
          ]
            .map(safeStr)
            .join(' ')
            .toLowerCase();

          return hay.includes(q);
        });
      }

      if (state.onlyDelta) {
        rows = rows.filter(r => {
          const d = minutesDelta(
            r.horaProgramada,
            r.aenaHoraEstimada || r.aenaHoraProgramada || r.horaEstimada
          );
          return d != null && Math.abs(d) >= 5;
        });
      }

      if (state.sort === 'time') {
        rows = [...rows].sort((a, b) =>
          safeStr(a.horaProgramada).localeCompare(safeStr(b.horaProgramada))
        );
      } else if (state.sort === 'flight') {
        rows = [...rows].sort((a, b) =>
          safeStr(a.numVuelo).localeCompare(safeStr(b.numVuelo))
        );
      } else if (state.sort === 'status') {
        rows = [...rows].sort((a, b) =>
          normStatus(a.estado).localeCompare(normStatus(b.estado))
        );
      }

      return rows.slice(0, Math.max(50, Math.min(state.limit, meta.defaults.max || 2000)));
    });

    const stats = computed(() => {
      const total = state.rows.length;
      const shown = filtered.value.length;
      const ver = state.rows.filter(r => !!r.aenaVerificado).length;
      const delta = state.rows.filter(r => {
        const d = minutesDelta(
          r.horaProgramada,
          r.aenaHoraEstimada || r.aenaHoraProgramada || r.horaEstimada
        );
        return d != null && Math.abs(d) >= 5;
      }).length;

      return { total, shown, ver, delta };
    });

    async function loadMeta() {
      try {
        const res = await fetch('/api/dashboard/meta');
        const j = await res.json();
        if (j?.ok) {
          meta.ok = true;
          meta.airports = j.airports || [];
          meta.defaults = { ...meta.defaults, ...(j.defaults || {}) };
          meta.server = j.server || meta.server;
          state.airport = meta.defaults.airport || state.airport;
          state.type = meta.defaults.type || state.type;
          state.daysAhead = meta.defaults.daysAhead ?? state.daysAhead;
        }
      } catch (e) {
        // ignore
      }
    }

    async function fetchSnapshot() {
      state.loading = true;
      state.error = null;

      try {
        const params = new URLSearchParams({
          airport: state.airport,
          type: state.type,
          daysAhead: String(state.daysAhead),
          limit: String(meta.defaults.max || 2000)
        });

        const res = await fetch(`/api/dashboard/snapshot?${params.toString()}`);
        const j = await res.json();

        if (!j?.ok) throw new Error(j?.error || 'snapshot_failed');

        const snap = normalizeSnapshotPayload(j);
        state.rows = snap.rows;
        state.lastUpdate = snap.now;
      } catch (e) {
        state.error = String(e?.message || e);
      } finally {
        state.loading = false;
      }
    }

    function connectWs() {
      const path = meta.defaults.wsPath || '/ws';
      const url = wsUrl(path);

      try { ws.value?.close?.(); } catch {}
      ws.value = null;

      const sock = new WebSocket(url);
      ws.value = sock;

      sock.onopen = () => {
        state.connected = true;
      };

      sock.onclose = () => {
        state.connected = false;
      };

      sock.onerror = () => {};

      sock.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);

          if (msg?.type === 'snapshot') {
            const snap = normalizeSnapshotPayload(msg);
            if (
              (msg.airport || msg?.payload?.airport || state.airport) === state.airport &&
              (msg.flightType || msg?.payload?.flightType || state.type) === state.type
            ) {
              state.rows = snap.rows;
              state.lastUpdate = snap.now;
            }
          }
        } catch {}
      };

      const sendSub = () => {
        try {
          sock.send(JSON.stringify({
            action: 'subscribe',
            airport: state.airport,
            flightType: state.type,
            daysAhead: state.daysAhead,
            limit: meta.defaults.max || 2000
          }));
        } catch {}
      };

      sock.addEventListener('open', sendSub);

      watch(() => [state.airport, state.type, state.daysAhead], () => {
        if (sock.readyState === WebSocket.OPEN) sendSub();
      });

      clearInterval(wsTimer.value);
      wsTimer.value = setInterval(() => {
        if (!ws.value) return;

        if (
          ws.value.readyState === WebSocket.CLOSED ||
          ws.value.readyState === WebSocket.CLOSING
        ) {
          connectWs();
          return;
        }

        if (ws.value.readyState === WebSocket.OPEN) {
          try {
            ws.value.send(JSON.stringify({ action: 'ping' }));
          } catch {}
        }
      }, 15000);
    }

    function badgeClass(st) {
      return `b ${statusMeta(st).cls}`;
    }

    function badgeLabel(st) {
      return statusMeta(st).label;
    }

    function deltaClass(row) {
      const d = minutesDelta(
        row.horaProgramada,
        row.aenaHoraEstimada || row.aenaHoraProgramada || row.horaEstimada
      );
      if (d == null) return '';
      const ad = Math.abs(d);
      if (ad >= 30) return 'delta delta-high';
      if (ad >= 10) return 'delta delta-med';
      if (ad >= 5) return 'delta delta-low';
      return 'delta';
    }

    function deltaText(row) {
      const d = minutesDelta(
        row.horaProgramada,
        row.aenaHoraEstimada || row.aenaHoraProgramada || row.horaEstimada
      );
      if (d == null) return '—';
      if (d > 0) return `+${d}`;
      return String(d);
    }

    onMounted(async () => {
      await loadMeta();
      await fetchSnapshot();
      connectWs();
    });

    onBeforeUnmount(() => {
      try { ws.value?.close?.(); } catch {}
      clearInterval(wsTimer.value);
    });

    watch(() => state.error, (v) => {
      if (!v) return;
      const t = setTimeout(() => fetchSnapshot(), 10000);
      return () => clearTimeout(t);
    });

    return {
      meta,
      state,
      filtered,
      statusOptions,
      summaryChips,
      stats,
      fmtTime,
      badgeClass,
      badgeLabel,
      deltaClass,
      deltaText,
      fetchSnapshot,
      flightLabel,
      routeLabel
    };
  },

  template: `
  <div class="page">
    <header class="top">
      <div class="brand">
        <div class="logoWrap">
          <img class="brandLogo" :src="logoUrl" alt="MenorcaBus" />
        </div>
        <div class="brandText">
          <div class="title">Flight Board</div>
          <div class="sub">
            {{ state.airport }} · {{ state.type === 'L' ? 'Llegadas' : 'Salidas' }} ·
            <span class="mono">{{ state.lastUpdate ? new Date(state.lastUpdate).toLocaleString() : '—' }}</span>
          </div>
        </div>
      </div>

      <div class="topActions">
        <div class="pill" :class="state.connected ? 'ok' : 'bad'">
          <span class="dot"></span>
          <span class="mono">ws: {{ state.connected ? 'connected' : 'offline' }}</span>
        </div>

        <select v-model="state.airport" class="segSelect">
          <option v-for="a in meta.airports" :key="a" :value="a">{{ a }}</option>
        </select>

        <div class="seg">
          <button class="segBtn" :class="{ active: state.type === 'L' }" @click="state.type = 'L'">Llegadas</button>
          <button class="segBtn" :class="{ active: state.type === 'S' }" @click="state.type = 'S'">Salidas</button>
        </div>

        <input
          class="searchTop"
          type="search"
          placeholder="Buscar: vuelo, compañía, destino…"
          v-model="state.search"
        />

        <select v-model="state.status" class="segSelect stateSelect">
          <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
    </header>

    <div class="layout">
      <aside class="sidebar">
        <div class="panel panelSummary">
          <div class="panelTitle">RESUMEN</div>

          <div class="summaryGrid">
            <div class="summaryCard">
              <div class="summaryLabel">Vuelos</div>
              <div class="summaryValue">{{ stats.total }}</div>
              <div class="summaryHint">Ventana: {{ state.daysAhead }} día(s)</div>
            </div>

            <div class="summaryCard">
              <div class="summaryLabel">Verificados AENA</div>
              <div class="summaryValue">{{ stats.ver }}</div>
              <div class="summaryHint">Auto refresh: {{ meta.defaults.pushMs / 1000 || 5 }}s</div>
            </div>
          </div>

          <div class="chipCloud">
            <button
              v-for="chip in summaryChips"
              :key="chip.code"
              class="summaryChip"
              :class="chip.meta.cls"
              @click="state.status = chip.code"
              :title="chip.meta.label"
            >
              <span>{{ chip.label }}</span>
              <strong>{{ chip.count }}</strong>
            </button>
          </div>
        </div>

        <div class="panel panelFilters">
          <div class="panelTitle">FILTROS</div>

          <div class="stack">
            <label>
              AENA
              <select v-model="state.aena">
                <option value="all">Todos</option>
                <option value="yes">Verificados</option>
                <option value="no">No verificados</option>
              </select>
            </label>

            <label>
              Orden
              <select v-model="state.sort">
                <option value="time">Hora</option>
                <option value="flight">Vuelo</option>
                <option value="status">Estado</option>
              </select>
            </label>

            <label>
              Límite
              <input type="number" min="50" :max="meta.defaults.max" v-model.number="state.limit" />
            </label>

            <label class="chk">
              <input type="checkbox" v-model="state.onlyDelta" />
              Solo con diferencia (≥5 min)
            </label>

            <button class="btn" @click="fetchSnapshot" :disabled="state.loading">
              {{ state.loading ? 'Cargando…' : 'Refrescar ahora' }}
            </button>
          </div>

          <div v-if="state.error" class="error">
            Error: <span class="mono">{{ state.error }}</span>
          </div>
        </div>
      </aside>

      <main class="content">
        <div class="panel boardPanel">
          <div class="panelTitle">PANTALLA</div>

          <div class="tableWrap">
            <table class="board">
              <thead>
                <tr>
                  <th class="t">Hora</th>
                  <th>Vuelo</th>
                  <th>Compañía</th>
                  <th>Origen/Destino</th>
                  <th>Estado</th>
                  <th class="t">Estimada</th>
                  <th class="t">AENA</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in filtered" :key="r.id" :class="r.aenaVerificado ? 'ver' : ''">
                  <td class="mono t strong">{{ fmtTime(r.horaProgramada) }}</td>

                  <td class="mono strong">{{ flightLabel(r) }}</td>

                  <td>{{ r.nombreCompania || r.compania || '—' }}</td>

                  <td class="routeCell">{{ routeLabel(r, state.type) }}</td>

                  <td>
                    <span :class="badgeClass(r.aenaEstado || r.estado)">
                      {{ badgeLabel(r.aenaEstado || r.estado) }}
                    </span>
                  </td>

                  <td class="mono t">
                    <div>{{ fmtTime(r.aenaHoraEstimada || r.aenaHoraProgramada || r.horaEstimada) }}</div>
                    <div :class="deltaClass(r)">{{ deltaText(r) }}</div>
                  </td>

                  <td class="t">
                    <span class="pill tiny" :class="r.aenaVerificado ? 'ok' : 'bad'">
                      {{ r.aenaVerificado ? 'OK' : 'NO' }}
                    </span>
                  </td>
                </tr>

                <tr v-if="!filtered.length && !state.loading">
                  <td colspan="7" class="emptyState">
                    No hay vuelos para los filtros actuales.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="foot">
            <div class="hint">MenorcaBus · Board responsive · usa chips laterales para filtrar estados al instante.</div>
            <div class="hint mono">Mostrados: {{ stats.shown }} / {{ stats.total }}</div>
          </div>
        </div>
      </main>
    </div>
  </div>
  `
};

createApp(App).mount('#app');