import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const postgresUrl = process.env.POSTGRES_URL?.trim();
    if (postgresUrl) {
      global._postgresPool = new Pool({
        connectionString: postgresUrl,
        ssl:
          process.env.SQL_SSL === 'false'
            ? false
            : { rejectUnauthorized: false },
        max: process.env.VERCEL ? 3 : 10,
        connectionTimeoutMillis: 15000,
      });
    } else {
      const host = process.env.SQL_HOST;
      const isUnixSocket = Boolean(host && host.startsWith('/'));
      const sslEnabled =
        process.env.SQL_SSL === 'true' ||
        (!isUnixSocket && process.env.VERCEL === '1' && process.env.SQL_SSL !== 'false');

      global._postgresPool = new Pool({
        host,
        port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : undefined,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
        max: process.env.VERCEL ? 3 : 10,
        connectionTimeoutMillis: 15000,
      });
    }

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
