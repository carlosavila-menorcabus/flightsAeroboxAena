function cleanCode(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function extractNumberPart(s) {
  const m = String(s || '').toUpperCase().match(/\d+/g);
  if (!m) return '';
  // keep leading zeros if present (AENA often uses them)
  return m.join('');
}

// Normaliza el número de vuelo para que Aerobox/AENA coincidan:
// - prefijo IATA (2 letras) + espacio + número (con ceros si vienen)
//   Ej: "IB 2502", "VY 0371"
export function normalizeFlightNumber({ iataCompania, compania, numVuelo }) {
  const iata = cleanCode(iataCompania);
  const comp = cleanCode(compania);
  const digits = extractNumberPart(numVuelo);

  const prefix = (iata && iata.length === 2)
    ? iata
    : (comp && comp.length === 2 ? comp : (iata || comp || ''));

  const normalized = prefix && digits ? `${prefix} ${digits}` : (digits || String(numVuelo || '').trim());

  return {
    compania: prefix || comp || iata || null,
    iataCompania: (iata && iata.length === 2) ? iata : (prefix && prefix.length === 2 ? prefix : null),
    numVuelo: normalized || null,
    number: digits || null
  };
}
