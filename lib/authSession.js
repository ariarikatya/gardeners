import { verifyToken } from '@/lib/jwt';

export async function hasActiveSessionForUser(req, user) {
  const token = req.cookies?.get('token')?.value;
  if (!token || !user?.id) return false;

  const payload = await verifyToken(token);
  return payload?.userId === user.id
    && payload?.phone === user.phone
    && payload?.role === user.role;
}
