import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createSqliteStore,
  createProduct,
  receiveStockBatch,
} from "./sqliteStore";
import { inspectPostgresSource } from "./postgresPreflight";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "shop-pg-preflight-"));
  dirs.push(dir);
  const source = join(dir, "source snapshot.sqlite");
  return { dir, source, db: createSqliteStore(source) };
}
const digest = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const cli = (args: string[], extraEnv: Record<string, string> = {}) =>
  spawnSync(
    process.execPath,
    ["--import", "tsx", resolve("scripts/postgres-preflight.ts"), ...args],
    { encoding: "utf8", env: { ...process.env, ...extraEnv } }
  );

describe("PostgreSQL migration preflight", () => {
  it("inventories the real schema and counts without seeding users, exporting row values or changing the source", () => {
    const { source, db } = fixture();
    createProduct(db, {
      name: "PRIVATE PRODUCT NAME",
      sku: "PRIVATE-SKU",
      price: 10,
      stock: 3,
    });
    db.exec('CREATE TABLE "odd""table" (id INTEGER PRIMARY KEY, note TEXT)');
    db.close();
    const before = digest(source),
      report = inspectPostgresSource(source);
    expect(report.sourceChecksPassed).toBe(true);
    expect(report.postgresReady).toBe(false);
    expect(report.implementationBlockers).toContain(
      "POSTGRES_BUSINESS_ADAPTER_NOT_IMPLEMENTED"
    );
    expect(report.tables.find(t => t.name === "products")?.rows).toBe("1");
    expect(report.tables.find(t => t.name === "app_users")?.rows).toBe("0");
    expect(report.tables.find(t => t.name === 'odd"table')?.rows).toBe("0");
    expect(
      report.tables
        .find(t => t.name === "sales")
        ?.indexes.some(i => i.name === "idx_sales_client_req" && i.partial)
    ).toBe(true);
    expect(
      report.tables.find(t => t.name === "sale_lot_allocations")?.foreignKeys
        .length
    ).toBe(2);
    expect(JSON.stringify(report)).not.toContain("PRIVATE PRODUCT");
    expect(JSON.stringify(report)).not.toContain("PRIVATE-SKU");
    expect(inspectPostgresSource(source).schemaSha256).toBe(
      report.schemaSha256
    );
    expect(digest(source)).toBe(before);
  });
  it("blocks orphan references and duplicate request IDs without printing the IDs or repairing records", () => {
    const { source, db } = fixture();
    db.exec("PRAGMA foreign_keys=OFF");
    db.prepare(
      "INSERT INTO member_transactions(member_number,type,detail,amount,balance_after) VALUES ('PRIVATE-MEMBER','deposit','test',1,1)"
    ).run();
    for (const order of ["A", "B"])
      db.prepare(
        "INSERT INTO sales(order_number,payment_method,subtotal,total,client_request_id) VALUES (?,'เงินสด',10,10,'PRIVATE-REQUEST')"
      ).run(order);
    db.close();
    const before = digest(source),
      report = inspectPostgresSource(source);
    expect(report.sourceChecksPassed).toBe(false);
    expect(report.findings).toContainEqual({
      code: "FOREIGN_KEY_VIOLATIONS",
      severity: "blocker",
      count: "1",
    });
    expect(report.findings).toContainEqual({
      code: "DUPLICATE_REQUEST_IDS:sales",
      severity: "blocker",
      count: "1",
    });
    expect(JSON.stringify(report)).not.toContain("PRIVATE-REQUEST");
    expect(JSON.stringify(report)).not.toContain("PRIVATE-MEMBER");
    expect(digest(source)).toBe(before);
  });
  it("flags unknown historical receipt values for review rather than treating them as zero", () => {
    const { source, db } = fixture();
    const p = createProduct(db, { name: "Historical", price: 20 });
    receiveStockBatch(
      db,
      [{ productId: p.id, purchaseQty: 10, freeQty: 2, paidAmount: 60 }],
      "Fixture"
    );
    db.prepare(
      "UPDATE stock_lots SET received_value_satang=NULL WHERE id=(SELECT MIN(id) FROM stock_lots)"
    ).run();
    db.close();
    const before = digest(source),
      report = inspectPostgresSource(source);
    expect(report.sourceChecksPassed).toBe(true);
    expect(report.findings).toContainEqual({
      code: "LEGACY_RECEIPT_VALUES_UNKNOWN",
      severity: "review",
      count: "1",
    });
    expect(digest(source)).toBe(before);
  });
  it("requires an existing explicit snapshot and never creates a missing database", () => {
    const { dir, source, db } = fixture();
    db.close();
    const missing = join(dir, "missing.sqlite");
    expect(() => inspectPostgresSource(missing)).toThrow();
    expect(existsSync(missing)).toBe(false);
    const result = cli([], { SQLITE_DB_PATH: missing });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--source is required");
    expect(existsSync(missing)).toBe(false);
    writeFileSync(join(dir, "bad.sqlite"), "not sqlite");
    expect(() => inspectPostgresSource(join(dir, "bad.sqlite"))).toThrow();
    expect(existsSync(source)).toBe(true);
  });
  it("writes an optional new report, preserves existing files and keeps readiness explicitly false", () => {
    const { dir, source, db } = fixture();
    db.close();
    const before = digest(source),
      output = join(dir, "report.json");
    const result = cli(["--source", source, "--out", output]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      scope: "read-only-preflight",
      sourceChecksPassed: true,
      postgresReady: false,
    });
    const reportBefore = readFileSync(output, "utf8");
    expect(cli(["--source", source, "--out", output]).status).toBe(1);
    expect(readFileSync(output, "utf8")).toBe(reportBefore);
    expect(cli(["--source", source, "--out", source]).status).toBe(1);
    expect(digest(source)).toBe(before);
  });
});
