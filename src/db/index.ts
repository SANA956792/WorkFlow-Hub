import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const isVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL);
    const postgresUrl = process.env.POSTGRES_URL?.trim();

    if (postgresUrl) {
      global._postgresPool = new Pool({
        connectionString: postgresUrl,
        ssl:
          process.env.SQL_SSL === 'false'
            ? false
            : { rejectUnauthorized: false },
        max: isVercel ? 2 : 10,
        idleTimeoutMillis: isVercel ? 5000 : 30000,
        connectionTimeoutMillis: isVercel ? 8000 : 15000,
        allowExitOnIdle: isVercel,
      });
    } else {
      const host = process.env.SQL_HOST;
      const isUnixSocket = Boolean(host && host.startsWith('/'));
      const sslEnabled =
        process.env.SQL_SSL === 'true' ||
        (!isUnixSocket && isVercel && process.env.SQL_SSL !== 'false');

      global._postgresPool = new Pool({
        host,
        port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : undefined,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
        max: isVercel ? 2 : 10,
        idleTimeoutMillis: isVercel ? 5000 : 30000,
        connectionTimeoutMillis: isVercel ? 8000 : 15000,
        allowExitOnIdle: isVercel,
      });
    }

    global._postgresPool.on('error', (err: any) => {
      console.error(
        'Unexpected error on idle SQL pool client:',
        err?.code || 'POOL_ERROR'
      );
    });
  }
  return global._postgresPool;
};

/**
 * Inspects connection mode without exposing any credentials, hostnames, or secrets.
 */
export function getPoolDiagnostics(): {
  source: 'postgres_url' | 'sql_params';
  poolerMode: 'transaction_pooler' | 'session_pooler' | 'direct_or_custom';
  serverless: boolean;
} {
  const isVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL);
  const postgresUrl = process.env.POSTGRES_URL?.trim();
  if (!postgresUrl) {
    return {
      source: 'sql_params',
      poolerMode: 'direct_or_custom',
      serverless: isVercel,
    };
  }
  try {
    const parsed = new URL(postgresUrl);
    const isSupabasePooler = parsed.hostname.endsWith('.pooler.supabase.com');
    const port = parsed.port || '5432';
    let poolerMode: 'transaction_pooler' | 'session_pooler' | 'direct_or_custom' =
      'direct_or_custom';
    if (isSupabasePooler && port === '6543') {
      poolerMode = 'transaction_pooler';
    } else if (isSupabasePooler && port === '5432') {
      poolerMode = 'session_pooler';
    }
    return { source: 'postgres_url', poolerMode, serverless: isVercel };
  } catch {
    return {
      source: 'postgres_url',
      poolerMode: 'direct_or_custom',
      serverless: isVercel,
    };
  }
}

const pool = createPool();

export const db = drizzle(pool, { schema });
