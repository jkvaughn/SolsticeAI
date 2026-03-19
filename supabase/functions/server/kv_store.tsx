// Key-value store backed by direct Postgres (no Supabase).

import sql from "./db.tsx";

const TABLE = "kv_store_49d15288";

export const set = async (key: string, value: unknown): Promise<void> => {
  await sql`
    INSERT INTO kv_store_49d15288 (key, value)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
};

export const get = async (key: string): Promise<unknown> => {
  const rows = await sql`
    SELECT value FROM kv_store_49d15288 WHERE key = ${key}
  `;
  return rows[0]?.value ?? null;
};

export const del = async (key: string): Promise<void> => {
  await sql`DELETE FROM kv_store_49d15288 WHERE key = ${key}`;
};

export const mset = async (keys: string[], values: unknown[]): Promise<void> => {
  const rows = keys.map((k, i) => ({ key: k, value: JSON.stringify(values[i]) }));
  await sql`
    INSERT INTO kv_store_49d15288 ${sql(rows, "key", "value")}
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value::jsonb
  `;
};

export const mget = async (keys: string[]): Promise<unknown[]> => {
  const rows = await sql`
    SELECT key, value FROM kv_store_49d15288 WHERE key = ANY(${keys})
  `;
  return rows.map((r: { value: unknown }) => r.value);
};

export const mdel = async (keys: string[]): Promise<void> => {
  await sql`DELETE FROM kv_store_49d15288 WHERE key = ANY(${keys})`;
};

export const getByPrefix = async (prefix: string): Promise<unknown[]> => {
  const rows = await sql`
    SELECT key, value FROM kv_store_49d15288 WHERE key LIKE ${prefix + "%"}
  `;
  return rows.map((r: { value: unknown }) => r.value);
};
