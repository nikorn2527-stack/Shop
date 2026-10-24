import { createRequire } from "node:module";
import { statSync } from "node:fs";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type Database = InstanceType<typeof DatabaseSync>;

const identifier = (name: string) => `"${name.replace(/"/g, '""')}"`;
type Finding = { code: string; severity: "blocker" | "review"; count?: string };
type Column = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};
const requiredTables = [
  "members",
  "member_transactions",
  "products",
  "stock_lots",
  "stock_movements",
  "sales",
  "sale_items",
  "app_users",
  "store_settings",
];
const count = (db: Database, sql: string) => {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  return String((statement.get() as { n: bigint }).n);
};

/** Inventory only. This never creates a database, runs Shop migrations, or connects to PostgreSQL. */
export function inspectPostgresSource(source: string) {
  if (!statSync(source).isFile())
    throw new Error("Source must be an existing SQLite snapshot file");
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec("BEGIN"); // A consistent read snapshot; rollback never writes application data.
    const integrity = db
      .prepare("PRAGMA quick_check")
      .all()
      .map(row => String(Object.values(row)[0]));
    const foreignKeyViolations = count(
      db,
      "SELECT COUNT(*) n FROM pragma_foreign_key_check"
    );
    const definitions = db
      .prepare(
        "SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string; sql: string }[];
    const findings: Finding[] = [];
    if (integrity.length !== 1 || integrity[0] !== "ok")
      findings.push({ code: "SQLITE_INTEGRITY", severity: "blocker" });
    if (foreignKeyViolations !== "0")
      findings.push({
        code: "FOREIGN_KEY_VIOLATIONS",
        severity: "blocker",
        count: foreignKeyViolations,
      });
    for (const table of requiredTables)
      if (!definitions.some(row => row.name === table))
        findings.push({ code: `MISSING_TABLE:${table}`, severity: "blocker" });
    const tables = definitions.map(table => ({
      name: table.name,
      rows: count(db, `SELECT COUNT(*) n FROM ${identifier(table.name)}`),
      createSql: table.sql,
      columns: db
        .prepare(`PRAGMA table_info(${identifier(table.name)})`)
        .all() as Column[],
      foreignKeys: db
        .prepare(`PRAGMA foreign_key_list(${identifier(table.name)})`)
        .all(),
      indexes: db
        .prepare(`PRAGMA index_list(${identifier(table.name)})`)
        .all()
        .map(index => ({
          name: String(index.name),
          unique: Boolean(index.unique),
          partial: Boolean(index.partial),
          columns: db
            .prepare(`PRAGMA index_info(${identifier(String(index.name))})`)
            .all()
            .map(column => column.name),
          sql:
            (
              db
                .prepare(
                  "SELECT sql FROM sqlite_schema WHERE type='index' AND name=?"
                )
                .get(String(index.name)) as { sql: string | null } | undefined
            )?.sql ?? null,
        })),
    }));
    for (const table of ["sales", "member_transactions"]) {
      if (
        !tables
          .find(row => row.name === table)
          ?.columns.some(column => column.name === "client_request_id")
      )
        continue;
      const duplicates = count(
        db,
        `SELECT COUNT(*) n FROM (SELECT client_request_id FROM ${identifier(table)} WHERE client_request_id IS NOT NULL GROUP BY client_request_id HAVING COUNT(*)>1)`
      );
      if (duplicates !== "0")
        findings.push({
          code: `DUPLICATE_REQUEST_IDS:${table}`,
          severity: "blocker",
          count: duplicates,
        });
    }
    const lots = tables.find(table => table.name === "stock_lots");
    if (lots?.columns.some(column => column.name === "received_value_satang")) {
      const unknown = count(
        db,
        "SELECT COUNT(*) n FROM stock_lots WHERE received_value_satang IS NULL OR received_qty IS NULL"
      );
      if (unknown !== "0")
        findings.push({
          code: "LEGACY_RECEIPT_VALUES_UNKNOWN",
          severity: "review",
          count: unknown,
        });
    }
    const triggers = db
      .prepare(
        "SELECT name,tbl_name AS tableName,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name"
      )
      .all();
    const views = db
      .prepare(
        "SELECT name,sql FROM sqlite_schema WHERE type='view' ORDER BY name"
      )
      .all();
    const schemaSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          tables: tables.map(({ rows, ...schema }) => schema),
          views,
          triggers,
        })
      )
      .digest("hex");
    return {
      schemaSha256,
      sqliteVersion: String(
        db.prepare("SELECT sqlite_version() AS version").get()!.version
      ),
      userVersion: Number(
        db.prepare("PRAGMA user_version").get()!.user_version
      ),
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceEngine: "sqlite",
      targetEngine: "postgresql",
      scope: "read-only-preflight",
      postgresReady: false,
      implementationBlockers: [
        "POSTGRES_BUSINESS_ADAPTER_NOT_IMPLEMENTED",
        "DATA_MIGRATION_AND_RECONCILIATION_NOT_IMPLEMENTED",
      ],
      sourceChecksPassed: !findings.some(
        finding => finding.severity === "blocker"
      ),
      integrity,
      foreignKeyViolations,
      tables,
      views,
      triggers,
      findings,
    };
  } finally {
    try {
      db.exec("ROLLBACK");
    } finally {
      db.close();
    }
  }
}
