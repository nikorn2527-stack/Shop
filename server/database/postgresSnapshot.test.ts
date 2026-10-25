import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteStore } from "../sqliteStore";
import {
  exportPostgresSnapshot,
  postgresDecimal,
  postgresSchema,
  postgresTimestamp,
} from "./postgresSnapshot";
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "shop-pg-export-"));
  directories.push(directory);
  const source = join(directory, "snapshot.sqlite"),
    output = join(directory, "private.sql");
  const db = createSqliteStore(source);
  db.prepare(
    "INSERT INTO members (member_number,first_name,last_name,balance,created_at) VALUES (?,?,?,?,?)"
  ).run(
    "00001",
    "ไทย O'Neil\\",
    "\nสมาชิก",
    123.45,
    "2026-10-25 00:01:02.123456"
  );
  db.prepare(
    "INSERT INTO products (sku,barcode,name,price,cost,stock,created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(
    "00002",
    "0000123456789",
    "สินค้า",
    2.5,
    1.9900123456,
    200,
    "2026-10-25 01:02:03"
  );
  db.prepare(
    "INSERT INTO stock_lots (product_id,lot,expiry_date,qty,cost,received_at) VALUES (1,'LOT-001','2028-02-29',200,1.99,'2026-10-25 01:02:03')"
  ).run();
  db.prepare(
    "INSERT INTO app_users (username,password_hash,display_name,created_at) VALUES ('owner','PRIVATE_HASH','ผู้บริหาร','2026-10-25 00:00:00')"
  ).run();
  db.prepare(
    "INSERT INTO app_sessions (id,user_id,expires_at,created_at,last_seen_at) VALUES ('PRIVATE_SESSION',1,'2026-10-26T00:00:00Z','2026-10-25 00:00:00','2026-10-25 00:00:00')"
  ).run();
  db.close();
  return { source, output, directory };
}
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("PostgreSQL migration rehearsal export (offline, not PG integration)", () => {
  it("covers every canonical table and column, including new payment/FIFO metadata", () => {
    const db = createSqliteStore(":memory:"),
      schema = postgresSchema();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all()
      .map(row => row.name);
    expect(schema.tables.map(table => table.name)).toEqual(tables);
    for (const table of schema.tables)
      expect(table.columns.map(column => column.name)).toEqual(
        db
          .prepare(`PRAGMA table_info("${table.name}")`)
          .all()
          .map(row => row.name)
      );
    expect(schema.sql).toContain("CREATE UNIQUE INDEX idx_sales_client_req");
    expect(schema.sql).toContain(
      "CREATE UNIQUE INDEX idx_member_tx_client_req"
    );
    expect(schema.sql).toContain("DEFERRABLE INITIALLY IMMEDIATE");
    expect(schema.sql).not.toMatch(
      /\bREAL\b|AUTOINCREMENT|DROP |TRUNCATE |IF NOT EXISTS/i
    );
    db.close();
  });
  it("exports all data without changing the snapshot, preserves leading zeroes/NULL/cost/Thai, and never includes rows in the result", () => {
    const { source, output, directory } = fixture(),
      before = hash(source);
    const result = exportPostgresSnapshot(source, output),
      sql = readFileSync(output, "utf8");
    expect(hash(source)).toBe(before);
    expect(result.sourceSha256).toBe(before);
    expect(result.postgresAppReady).toBe(false);
    expect(Object.keys(result.tables)).toHaveLength(25);
    expect(result.tables.members).toBe("1");
    expect(result.tables.app_sessions).toBe("1");
    expect(sql).toContain("'00001'");
    expect(sql).toContain("'0000123456789'");
    expect(sql).toContain("ไทย O''Neil\\");
    expect(sql).toContain("1.9900123456");
    expect(sql).toContain("'2026-10-25T00:01:02.123456+07:00'");
    expect(sql).toContain("'2026-10-26T00:00:00Z'");
    expect(sql).toContain("'2028-02-29'");
    expect(sql).toContain("NULL");
    expect(sql).toContain("PRIVATE_HASH");
    expect(sql).toContain("PRIVATE_SESSION");
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_HASH|PRIVATE_SESSION|ไทย|00001/
    );
    expect(sql).toContain("Use a dedicated shop_pg_rehearsal_ database");
    expect(sql).toContain("SET CONSTRAINTS ALL IMMEDIATE;");
    expect(sql).toMatch(/COMMIT;\n$/);
    expect(sql).toContain("pg_get_serial_sequence");
    expect(sql).toContain("Migration count mismatch: stock_lots");
    expect(sql).toContain(
      'COALESCE(SUM("balance"), 0) FROM shop."members") <> 123.45'
    );
    expect(sql).toContain(
      "Migration total mismatch: stock_lots.remaining_value_satang"
    );
    expect(
      sql.indexOf("CREATE FUNCTION shop.assign_card_usage_session")
    ).toBeGreaterThan(
      sql.lastIndexOf("Migration count mismatch: store_settings")
    );
    expect(readdirSync(directory).some(file => file.includes("partial"))).toBe(
      false
    );
    if (process.platform !== "win32")
      expect(statSync(output).mode & 0o777).toBe(0o600);
  });
  it("refuses existing output and a live WAL, and does not create a missing source", () => {
    const { source, output, directory } = fixture();
    writeFileSync(output, "keep");
    expect(() => exportPostgresSnapshot(source, output)).toThrow(
      /already exists/
    );
    expect(readFileSync(output, "utf8")).toBe("keep");
    rmSync(output);
    writeFileSync(source + "-wal", "not a snapshot");
    expect(() => exportPostgresSnapshot(source, output)).toThrow(/WAL/);
    expect(existsSync(output)).toBe(false);
    const missing = join(directory, "missing.sqlite");
    expect(() => exportPostgresSnapshot(missing, output)).toThrow();
    expect(existsSync(missing)).toBe(false);
  });
  it.each([
    "ALTER TABLE members ADD COLUMN unknown TEXT",
    "CREATE TABLE unknown (id INTEGER)",
    "CREATE VIEW private_view AS SELECT * FROM members",
    "CREATE TRIGGER custom AFTER INSERT ON members BEGIN SELECT 1; END",
  ])("refuses unsupported schema: %s", statement => {
    const { source, output } = fixture();
    const db = createSqliteStore(source);
    db.exec(statement);
    db.close();
    expect(() => exportPostgresSnapshot(source, output)).toThrow(
      /schema differs|Unsupported source/
    );
    expect(existsSync(output)).toBe(false);
  });
  it.each([
    ["UPDATE members SET balance=1.001", /lose precision/],
    ["UPDATE app_users SET active=2", /Boolean/],
    ["UPDATE members SET created_at='2026-02-30 00:00:00'", /calendar/],
    ["UPDATE stock_lots SET expiry_date='2569-99-99'", /calendar/],
    ["UPDATE products SET name=char(0)", /NUL/],
  ] as const)(
    "cleans up failed exports without exposing cell contents: %s",
    (statement, error) => {
      const { source, output, directory } = fixture();
      const db = createSqliteStore(source);
      db.exec(statement);
      db.close();
      const before = hash(source);
      expect(() => exportPostgresSnapshot(source, output)).toThrow(error);
      expect(existsSync(output)).toBe(false);
      expect(hash(source)).toBe(before);
      expect(
        readdirSync(directory).some(file => file.includes("partial"))
      ).toBe(false);
    }
  );
  it("blocks duplicate retry keys before target import", () => {
    const { source, output } = fixture(),
      db = createSqliteStore(source);
    for (const order of ["SALE-1", "SALE-2"])
      db.prepare(
        "INSERT INTO sales (order_number,payment_method,subtotal,total,client_request_id) VALUES (?,'เงินสด',1,1,'duplicate')"
      ).run(order);
    db.close();
    expect(() => exportPostgresSnapshot(source, output)).toThrow(
      /Duplicate request IDs/
    );
    expect(existsSync(output)).toBe(false);
  });
  it("does not delete a pre-existing temporary export file", () => {
    const { source, output } = fixture();
    const clock = vi.spyOn(Date, "now").mockReturnValue(42);
    const temporary = output + `.partial-${process.pid}-42`;
    writeFileSync(temporary, "keep existing file");
    try {
      expect(() => exportPostgresSnapshot(source, output)).toThrow();
      expect(readFileSync(temporary, "utf8")).toBe("keep existing file");
      expect(existsSync(output)).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });
  it("preserves bigint IDs beyond JS safe integers without a Number conversion", () => {
    const { source, output } = fixture(),
      db = createSqliteStore(source);
    db.prepare(
      "INSERT INTO audit_logs (id,action,actor,created_at) VALUES (?,'test','test','2026-10-25 00:00:00')"
    ).run(9007199254740993n);
    db.close();
    exportPostgresSnapshot(source, output);
    expect(readFileSync(output, "utf8")).toContain("VALUES (9007199254740993,");
  });
});

describe("lossless target values", () => {
  it("expands decimals, retaining 10-place cost precision without silent rounding", () => {
    expect(postgresDecimal(1e-10, 24, 10)).toBe("0.0000000001");
    expect(postgresDecimal(1e18, 24, 2)).toBe("1000000000000000000");
    expect(postgresDecimal(-123.45, 20, 2)).toBe("-123.45");
    expect(postgresDecimal(9007199254740993n, 20, 2)).toBe("9007199254740993");
    for (const value of [1.001, Infinity, NaN, 1e20])
      expect(() => postgresDecimal(value, 20, 2)).toThrow();
  });
  it("converts Bangkok wall time and preserves explicit zone/fraction precision", () => {
    expect(postgresTimestamp("2026-10-25 14:42:33")).toBe(
      "2026-10-25T14:42:33+07:00"
    );
    expect(postgresTimestamp("2026-10-25T07:42:33.123456Z")).toBe(
      "2026-10-25T07:42:33.123456Z"
    );
    expect(postgresTimestamp("2026-10-25")).toBe("2026-10-25T00:00:00+07:00");
    for (const value of [
      "2026-02-29",
      "2026-10-25 24:00:00",
      "2026-10-25 12:99:00",
      "2026-10-25T12:00:00+14:01",
      "PRIVATE_INVALID_DATE",
    ])
      expect(() => postgresTimestamp(value)).toThrow();
  });
});
