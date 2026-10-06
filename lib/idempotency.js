const processedKeys = new Map();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getIdempotencyKey(req) {
  if (!req || !req.headers) return null;
  return req.headers.get('idempotency-key') || req.headers.get('x-idempotency-key') || null;
}

export function getCachedIdempotencyResponse(key) {
  if (!key) return null;
  const entry = processedKeys.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL_MS) {
    processedKeys.delete(key);
    return null;
  }
  return entry;
}

export function setCachedIdempotencyResponse(key, status, body) {
  if (!key) return;
  processedKeys.set(key, { status, body, timestamp: Date.now() });
  if (processedKeys.size > 1000) {
    const now = Date.now();
    for (const [k, v] of processedKeys.entries()) {
      if (now - v.timestamp > TTL_MS) processedKeys.delete(k);
    }
  }
}
