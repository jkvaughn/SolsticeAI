// Direct Postgres connection for Azure production.
// No Supabase fallback — fails fast if DATABASE_URL is missing.
// Uses deno-postgres (Deno-native) instead of npm:postgres to avoid
// CONNECT_TIMEOUT undefined:undefined in Container Apps.

import { Pool } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required — Supabase is not used in production");
}

// Ensure sslmode=require is in the URL for Azure Postgres
const connUrl = DATABASE_URL.includes("sslmode=")
  ? DATABASE_URL
  : DATABASE_URL + (DATABASE_URL.includes("?") ? "&" : "?") + "sslmode=require";

const parsed = new URL(connUrl);
console.log(`[db] Connecting to ${parsed.hostname}:${parsed.port || 5432}/${parsed.pathname.slice(1)} as ${parsed.username}`);

const pool = new Pool(connUrl, 10, true); // url, size, lazy

// Tagged-template SQL interface compatible with npm:postgres usage.
// sql`SELECT * FROM banks WHERE id = ${id}` → pool.queryObject(text, args)
type SqlResult = Record<string, unknown>[];
interface SqlTag {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlResult>;
  // Helper for bulk insert: sql`INSERT INTO table ${sql(rows, ...cols)}`
  (rows: Record<string, unknown>[], ...columns: string[]): { __fragment: true; text: string; values: unknown[] };
  // Identifier mode: sql`SELECT * FROM ${sql(tableName)}` — safe SQL identifier
  (identifier: string): { __fragment: true; text: string; values: unknown[] };
}

function buildQuery(strings: TemplateStringsArray, values: unknown[]): { text: string; args: unknown[] } {
  let text = "";
  const args: unknown[] = [];
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      const v = values[i];
      // Check if this is a fragment from sql(rows, ...cols) helper
      if (v && typeof v === "object" && "__fragment" in (v as Record<string, unknown>)) {
        const frag = v as { text: string; values: unknown[] };
        // Renumber placeholders in fragment
        const offset = args.length;
        const renumbered = frag.text.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + offset}`);
        text += renumbered;
        args.push(...frag.values);
      } else {
        args.push(v);
        text += `$${args.length}`;
      }
    }
  }
  return { text, args };
}

const sql: SqlTag = function (
  stringsOrRows: TemplateStringsArray | Record<string, unknown>[],
  ...valuesOrCols: unknown[]
): any {
  // Identifier mode: sql("table_name") — returns a safe SQL identifier fragment
  if (typeof stringsOrRows === "string") {
    const ident = stringsOrRows as string;
    // Sanitize: only allow alphanumeric, underscore, dot (for schema.table)
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(ident)) {
      throw new Error(`Invalid SQL identifier: ${ident}`);
    }
    return { __fragment: true, text: `"${ident}"`, values: [] };
  }

  // Helper mode: sql(record, "col1", "col2") or sql([records], "col1", "col2")
  // — returns a fragment for INSERT. Accepts a single object or an array of objects.
  if (
    (Array.isArray(stringsOrRows) && stringsOrRows.length > 0 && typeof stringsOrRows[0] === "object" && !("raw" in stringsOrRows)) ||
    (!Array.isArray(stringsOrRows) && typeof stringsOrRows === "object" && stringsOrRows !== null && !("raw" in stringsOrRows))
  ) {
    const rows = Array.isArray(stringsOrRows) ? stringsOrRows as Record<string, unknown>[] : [stringsOrRows as Record<string, unknown>];
    const columns = valuesOrCols as string[];
    if (rows.length === 0) return { __fragment: true, text: "VALUES ", values: [] };

    const allValues: unknown[] = [];
    const rowPlaceholders: string[] = [];
    for (const row of rows) {
      const placeholders: string[] = [];
      for (const col of columns) {
        allValues.push(row[col]);
        placeholders.push(`$${allValues.length}`);
      }
      rowPlaceholders.push(`(${placeholders.join(", ")})`);
    }
    const colList = columns.map((c) => `"${c}"`).join(", ");
    return {
      __fragment: true,
      text: `(${colList}) VALUES ${rowPlaceholders.join(", ")}`,
      values: allValues,
    };
  }

  // Tagged template mode: sql`SELECT ...`
  const strings = stringsOrRows as TemplateStringsArray;
  const values = valuesOrCols;
  const { text, args } = buildQuery(strings, values);

  return (async () => {
    const client = await pool.connect();
    try {
      const result = await client.queryObject(text, args);
      // Normalize deno-postgres types to match Supabase client behavior:
      // - BigInt → Number (prevents "Cannot mix BigInt and other types")
      // - Date → ISO string (Supabase returns strings, deno-postgres returns Date objects)
      return (result.rows as SqlResult).map(row => {
        const converted: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(row)) {
          converted[key] = typeof val === 'bigint' ? Number(val)
                         : val instanceof Date ? val.toISOString()
                         : val;
        }
        return converted;
      });
    } finally {
      client.release();
    }
  })();
} as SqlTag;

export default sql;
