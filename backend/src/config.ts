import crypto from 'crypto';

function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  const ephemeral = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: JWT_SECRET not set. Using random ephemeral secret — tokens will not survive restarts.');
  return ephemeral;
}

export const JWT_SECRET = resolveJwtSecret();
