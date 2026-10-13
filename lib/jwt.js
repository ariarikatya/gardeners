import { SignJWT, jwtVerify } from 'jose';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('[CRITICAL CONFIG ERROR] JWT_SECRET is not set in environment variables! Using fallback secret in production causes session resets on restart.');
}

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-use-env-in-prod');

export async function signToken(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(SECRET);
}

export async function verifyTokenDetailed(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return { payload, error: null };
  } catch (err) {
    const code = err.code || 'UNKNOWN_JWT_ERROR';
    const message = err.message || String(err);
    return { payload: null, error: code, message };
  }
}

export async function verifyToken(token) {
  const result = await verifyTokenDetailed(token);
  return result.payload;
}
