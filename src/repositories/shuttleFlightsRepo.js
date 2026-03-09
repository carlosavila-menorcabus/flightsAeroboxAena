import { pool } from '../db/pool.js';
import { config } from '../config.js';

const T = () => config.TABLE_AEROBOX;

/**
 * Range query (days) - usado por dashboard snapshot y similares.
 */
export async function getFlightsFromDatabase({ airport, flightType, startYmd, endYmd, limit = 5000 }) {
  const sql = `
    SELECT *
    FROM ${T()}
    WHERE iataAena = :airport
      AND tipoVuelo = :flightType
      AND fecha BETWEEN :start AND :end
    ORDER BY fecha ASC, horaProgramada ASC
    LIMIT ${Number(limit) || 5000}
  `;

  const [rows] = await pool.execute(sql, {
    airport,
    flightType,
    start: startYmd,
    end: endYmd
  });

  return rows;
}

/**
 * 12h time window query (modo Aerobox legacy).
 */
export async function getFlightsFromDatabaseTimeWindow({ airport, flightType, dayYmd, startTime, endTime, limit = 1000 }) {
  const sql = `
    SELECT *
    FROM ${T()}
    WHERE iataAena = ?
      AND tipoVuelo = ?
      AND DATE(fecha) = ?
      AND horaProgramada BETWEEN ? AND ?
    ORDER BY horaProgramada ASC
    LIMIT ?
  `;
  const params = [airport, flightType, dayYmd, startTime, endTime, Number(limit)];
  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * Inserta Aerobox (cache) sin machacar datos.
 * OJO: en v1.0 Aerobox solo debe rellenar si no existe o si quieres un comportamiento "cache only".
 */
export async function insertFlightsData(flights) {
  if (!Array.isArray(flights) || flights.length === 0) return { inserted: 0 };

  const sql = `
    INSERT INTO ${T()} 
      (compania, numVuelo, fecha, horaProgramada, fechaEstimada, horaEstimada, iataAena, iataOtro, codigosCompania, iataCompania, tipoVuelo, estado, nombreCompania, updated_timetamp, updated_at)
    VALUES
      (:compania, :numVuelo, :fecha, :horaProgramada, :fechaEstimada, :horaEstimada, :iataAena, :iataOtro, :codigosCompania, :iataCompania, :tipoVuelo, :estado, :nombreCompania, :updated_timetamp, NOW())
    ON DUPLICATE KEY UPDATE
      updated_at = updated_at
  `;

  let inserted = 0;

  for (const f of flights) {
    try {
      await pool.execute(sql, f);
      inserted++;
    } catch {
      // ignore individual row errors
    }
  }

  return { inserted };
}

/**
 * Retry helper: reintenta en deadlock/lock wait timeout.
 */
async function execWithDeadlockRetry(sql, values, logger, maxRetries = 6) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await pool.execute(sql, values);
    } catch (err) {
      const code = err?.code || '';
      const errno = err?.errno || 0;

      const isDeadlock = code === 'ER_LOCK_DEADLOCK' || errno === 1213;
      const isLockWait = code === 'ER_LOCK_WAIT_TIMEOUT' || errno === 1205;

      if (!(isDeadlock || isLockWait) || i === maxRetries) {
        throw err;
      }

      const wait = 150 * Math.pow(2, i); // 150, 300, 600, 1200, ...
      logger?.warn?.({ attempt: i + 1, wait, code, errno }, 'DB retry (deadlock/lockwait)');
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/**
 * AENA es canónico para corto plazo.
 * Upsert + overwrite de campos principales + rellena campos aena* en la misma fila.
 *
 * IMPORTANTE:
 * - Para evitar "cuelgues" por deadlocks, este método reintenta automáticamente.
 * - Recomiendo además bajar CONCURRENCY o CHUNK, pero esto ya te salva la mayoría.
 */
export async function upsertFlightsFromAenaBatch(flights, currentTs, logger) {
  if (!Array.isArray(flights) || flights.length === 0) return { upserts: 0 };

  const placeholders = [];
  const values = [];

  for (const f of flights) {
    // 21 columnas totales, 2 NOW() fijas, 19 placeholders (los NOW() no cuentan como '?'):
    // ... updated_at NOW(), aenaVerificadoAt NOW(), y 5 campos aena* + aenaVerificado
    placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?)');

    values.push(
      // base fields
      f.compania,
      f.numVuelo,
      f.fecha,
      f.horaProgramada,
      f.fechaEstimada,
      f.horaEstimada,
      f.iataAena,
      f.iataOtro,
      f.codigosCompania,
      f.iataCompania,
      f.tipoVuelo,
      f.estado,
      f.nombreCompania,
      currentTs,

      // aena snapshot fields (también se reflejan en aena* para auditoría)
      1, // aenaVerificado
      f.horaProgramada ?? null, // aenaHoraProgramada
      f.fechaEstimada ?? null,  // aenaFechaEstimada
      f.horaEstimada ?? null,   // aenaHoraEstimada
      f.estado ?? null          // aenaEstado
    );
  }

  const sql = `
    INSERT INTO ${T()} (
      compania, numVuelo, fecha, horaProgramada,
      fechaEstimada, horaEstimada,
      iataAena, iataOtro,
      codigosCompania, iataCompania,
      tipoVuelo, estado, nombreCompania,
      updated_timetamp,
      updated_at,
      aenaVerificadoAt,
      aenaVerificado,
      aenaHoraProgramada,
      aenaFechaEstimada,
      aenaHoraEstimada,
      aenaEstado
    ) VALUES ${placeholders.join(', ')}
    ON DUPLICATE KEY UPDATE
      -- AENA pisa los campos canónicos
      fechaEstimada = VALUES(fechaEstimada),
      horaEstimada  = VALUES(horaEstimada),
      estado        = VALUES(estado),
      iataOtro      = VALUES(iataOtro),
      codigosCompania = VALUES(codigosCompania),
      iataCompania  = VALUES(iataCompania),
      nombreCompania = VALUES(nombreCompania),
      horaProgramada = VALUES(horaProgramada),
      fecha         = VALUES(fecha),
      updated_timetamp = VALUES(updated_timetamp),
      updated_at = NOW(),

      -- marca/actualiza verificación
      aenaVerificado = 1,
      aenaVerificadoAt = NOW(),
      aenaHoraProgramada = VALUES(aenaHoraProgramada),
      aenaFechaEstimada = VALUES(aenaFechaEstimada),
      aenaHoraEstimada = VALUES(aenaHoraEstimada),
      aenaEstado = VALUES(aenaEstado)
  `;

  const [res] = await execWithDeadlockRetry(sql, values, logger);
  return { upserts: res?.affectedRows ?? 0 };
}

export async function getMaxAenaSyncTs({ startYmd, endYmd }) {
  const sql = `
    SELECT MAX(updated_timetamp) AS maxTs
    FROM ${T()}
    WHERE aenaVerificado = 1
      AND DATE(fecha) BETWEEN :start AND :end
  `;
  const [rows] = await pool.execute(sql, { start: startYmd, end: endYmd });
  const v = rows?.[0]?.maxTs;
  return v ? Number(v) : null;
}

export async function deleteNotMatchedAfterSync({ startYmd, endYmd, syncTs }) {
  if (!syncTs) return 0;
  const sql = `
    DELETE FROM ${T()}
    WHERE aenaVerificado = 1
      AND DATE(fecha) BETWEEN :start AND :end
      AND (updated_timetamp IS NULL OR updated_timetamp < :syncTs)
  `;
  const [res] = await pool.execute(sql, { start: startYmd, end: endYmd, syncTs: Number(syncTs) });
  return res?.affectedRows ?? 0;
}

export async function deleteOlderThan({ cutoffYmd }) {
  const sql = `
    DELETE FROM ${T()}
    WHERE DATE(fecha) < :cutoff
  `;
  const [res] = await pool.execute(sql, { cutoff: cutoffYmd });
  return res?.affectedRows ?? 0;
}

export async function updateAenaVerification({ id, patch }) {
  const keys = Object.keys(patch || {});
  if (!id || keys.length === 0) return 0;

  const sets = keys.map((k) => `\`${k}\` = :${k}`).join(', ');
  const sql = `UPDATE ${T()} SET ${sets} WHERE id = :id`;
  const [res] = await pool.execute(sql, { id, ...patch });
  return res?.affectedRows ?? 0;
}

export async function getFlightsToVerify({ startYmd, endYmd, staleMinutes, limit }) {
  const sql = `
    SELECT id, compania, numVuelo, fecha, horaProgramada, tipoVuelo, iataAena
    FROM ${T()}
    WHERE fecha BETWEEN :start AND :end
      AND (
        aenaVerificadoAt IS NULL
        OR aenaVerificadoAt < (NOW() - INTERVAL :stale MINUTE)
      )
    ORDER BY fecha ASC, horaProgramada ASC
    LIMIT ${Number(limit) || 5000}
  `;

  const [rows] = await pool.execute(sql, {
    start: startYmd,
    end: endYmd,
    stale: Number(staleMinutes) || 15
  });

  return rows;
}