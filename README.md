# MenorcaBus Flights Service (Aerobox + AENA)

Este proyecto unifica **flight-main** (cache Aerobox) + **aena-flights-ms** (sync AENA) en **un microservicio**.

Objetivo:
- **Una sola tabla**: `shuttle_flights`.
- **AENA** (corto plazo, `MAX_DAYS_AHEAD`), y el job **sync** sobreescribe los campos principales (`horaProgramada`, `horaEstimada`, `estado`, etc.).
- **Aerobox** se usa **solo on-demand** cuando Laravel pide un vuelo que no existe en DB (ventana de 12h), y se guarda en la misma tabla.
- Se normaliza `numVuelo` (ej. `IB 2502`) para que Aerobox/AENA coincidan.

---

## Requisitos

- Node.js 20+ (recomendado Node 23)
- MySQL/MariaDB con la tabla `shuttle_flights` existente

---

## Instalación

```bash
npm i
npm run dev
# o
npm start
```

---

## Migraciones SQL

Ejecuta en la **misma DB** `shuttle_flights`:

- `sql/02_alter_shuttle_flights_add_aena_verification.sql`

---

## Variables de entorno (.env)

Mínimas:

```env
PORT=3015
HOST=0.0.0.0
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=...
DB_PASS=...
DB_NAME=...

AERODATABOX_API_KEY=...

# Para proteger jobs
JOB_TOKEN=supersecreto

# Para proteger /api
# API_KEY=...
# ALLOWED_IPS=1.2.3.4,5.6.7.8
```

AENA:

```env
AENA_BASE=https://www.aena.es/sites/Satellite?pagename=AENA_ConsultarVuelos
CONCURRENCY=6
MAX_DAYS_PAST=1
MAX_DAYS_AHEAD=2
```

Scheduler (opcional):

```env
ENABLE_SCHEDULER=1
CRON_AENA_SYNC=*/10 * * * *
CRON_AENA_VERIFY=*/10 * * * *
```

Mail (opcional):

```env
MAIL_ENABLED=1
MAIL_TO=tu-email@...
SMTP_HOST=smtp.tudominio.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_SECURE=0
SMTP_IGNORE_TLS=0
SMTP_TLS_REJECT_UNAUTHORIZED=1
```

---

## Endpoints

## Dashboard (pantalla tipo aeropuerto)

La ruta **`/`** sirve un dashboard **Vue 3** (responsive) que se actualiza usando WebSocket.

El dashboard está publicado como **dist estático** en `public/dist/`.

### Variables

```env
# Dashboard
DASHBOARD_ENABLED=1
DASHBOARD_PUBLIC=1       
DASHBOARD_WS_PATH=/ws
DASHBOARD_PUSH_MS=5000   
DASHBOARD_DEFAULT_AIRPORT=MAH
DASHBOARD_DEFAULT_TYPE=L
DASHBOARD_MAX_LIMIT=2000
```

### Health

- `GET /health`

### Vuelos (API Laravel)

- Modo ventana 12h:
  - `GET /api/flights?airport=MAH&type=L&date=2026-03-04T08:00`

**Comportamiento**:
- Primero consulta `shuttle_flights`.
- Si no hay datos para esa ventana, consulta Aerobox y guarda en DB.
- Si existe un registro, el output ya contendrá los últimos datos AENA si el sync los ha refrescado.

### Logos compañías

- `GET /api/airlines/logo/VY`

Devuelve `{ url: "/airlines/VY.png" }` y si no existe, lo descarga (pics.avs.io) y lo cachea en `public/airlines/`.

### Jobs

Protegidos por `Authorization: Bearer <JOB_TOKEN>` si `JOB_TOKEN` está definido.

- `POST /jobs/aena/sync`
- `POST /jobs/aena/sync?async=1` (responde 202 y ejecuta en background)

- `POST /jobs/aena/verify`
- `POST /jobs/aena/verify?async=1`

---

## Cómo funciona el “verify”

El endpoint `/jobs/aena/verify` ahora es un **mantenimiento**:
- Borra vuelos AENA “no vistos” en el último sync (not matched) dentro del rango `MAX_DAYS_PAST..MAX_DAYS_AHEAD`.
- Borra vuelos demasiado antiguos (fecha < hoy - `MAX_DAYS_PAST`).

En el email se reporta todo como **Deleted**.

---

## Nota sobre borrados

En el servicio AENA inicial, el borrado (`deleteObsolete`) dependía de un `updated_timetamp` de “la ejecución”.
Si disparabas dos runs muy seguidos, algunos registros podían quedar con `updated_timetamp` de la ejecución anterior y entrar como “obsoletos” y ser eliminados.


## Producción (Linux)

En Linux el servicio va igual. El endpoint se llama desde Laravel como ahora (misma idea). Para jobs:

```bash
curl -X POST "https://flights.menorcabus.com/jobs/aena/sync?async=1" \
  -H "Authorization: Bearer supersecreto"

curl -X POST "https://flights.menorcabus.com/jobs/aena/verify?async=1" \
  -H "Authorization: Bearer supersecreto"
```

Si prefieres cron del sistema, deja `ENABLE_SCHEDULER=0` y ejecuta esos `curl` cada X minutos.

api service llegadas / salidas mañana y tarde
curl.exe -s -H "Authorization: Bearer supersecreto" "http://127.0.0.1:3015/api/flights?airport=MAH&type=L&date=2026-03-07T08:00"
curl.exe -s -H "Authorization: Bearer supersecreto" "http://127.0.0.1:3015/api/flights?airport=MAH&type=L&date=2026-03-07T15:00"
curl.exe -s -H "Authorization: Bearer supersecreto" "http://127.0.0.1:3015/api/flights?airport=MAH&type=S&date=2026-03-07T08:00"

Obtener vuelos 01/08/2026 (Aerobox)
curl.exe -s -H "Authorization: Bearer supersecreto" "http://127.0.0.1:3015/api/flights?airport=MAH&type=L&date=2026-08-01T08:00"
curl.exe -s -H "Authorization: Bearer supersecreto" "http://127.0.0.1:3015/api/flights?airport=MAH&type=L&date=2026-08-01T15:00"
curl.exe -s -H "Authorization: Bearer supersecreto" "http://127.0.0.1:3015/api/flights?airport=MAH&type=L&date=2026-08-01T15:00"

AENA verify
curl.exe -i -X POST "http://127.0.0.1:3015/jobs/aena/verify?async=1" -H "Authorization: Bearer supersecreto"
curl.exe -X POST -H "Authorization: Bearer supersecreto" http://127.0.0.1:3015/jobs/aena/sync?async=1