import mysql from 'mysql2/promise';
import { config } from '../config.js';

export const pool = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASS,
  database: config.DB_NAME,
  waitForConnections: true,
  connectionLimit: config.DB_CONN_LIMIT,
  namedPlaceholders: true,
  timezone: 'Z'
});

export async function pingDb() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows?.[0]?.ok === 1;
}
