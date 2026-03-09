import { apiGuard } from './aeroboxFlights.js';
import { getLogoUrlOrFetch } from '../lib/airlineLogos.js';

export async function registerAirlinesRoutes(app) {
  app.get('/api/airlines/logo/:iata', { preHandler: apiGuard }, async (req, reply) => {
    const iata = String(req.params?.iata || '').trim().toUpperCase();
    if (!iata) return reply.code(400).send({ ok: false, error: 'iata required' });

    const url = await getLogoUrlOrFetch(iata);
    return { ok: true, iata, url };
  });
}
