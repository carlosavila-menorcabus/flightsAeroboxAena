import { pool } from '../db/pool.js';

export async function getAirlinesByIata(iataCodes = []) {
  if (!Array.isArray(iataCodes) || iataCodes.length === 0) return [];

  // Unique codes
  const codes = [...new Set(iataCodes.map(c => String(c || '').trim().toUpperCase()).filter(Boolean))];
  if (codes.length === 0) return [];

  const placeholders = codes.map((_, i) => `:c${i}`).join(',');
  const params = Object.fromEntries(codes.map((c, i) => [`c${i}`, c]));

  const sql = `SELECT DISTINCT iataCompania AS iata, nombreCompania AS name FROM shuttle_flights WHERE iataCompania IN (${placeholders}) AND nombreCompania IS NOT NULL AND nombreCompania <> ''`;
  const [rows] = await pool.execute(sql, params);
  return rows;
}
