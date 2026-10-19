// Run after pnpm build: node --import tsx scripts/opening-stock-import-smoke.mjs
// All writes use an isolated /tmp database, never the shop's business database.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import puppeteer from "puppeteer";
import {
  openWelfareStore,
  setEditionSettings,
  createAppSession,
  checkout,
} from "../server/sqliteStore.ts";
import { importProducts } from "../server/importTool.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-opening-stock-"));
const target = path.join(dir, "demo.sqlite");
process.env.SEED_DEMO_DATA = "1";
process.env.NODE_ENV = "development";
const db = openWelfareStore(target);
setEditionSettings(db, { trialStart: new Date().toISOString().slice(0, 10) });
const admin = db
  .prepare("SELECT id FROM app_users WHERE role='admin' LIMIT 1")
  .get();
const session = createAppSession(db, admin.id);
assert.deepEqual(
  importProducts(db, {
    rows: [["00001", "Opening stock fixture", "5", "11.5", "50"]],
    mapping: { barcode: 0, name: 1, price: 2, cost: 3, stock: 4 },
    duplicateMode: "replace",
  }).errors,
  []
);
const product = db
  .prepare("SELECT id FROM products WHERE barcode='00001'")
  .get();
checkout(db, {
  items: [{ productId: product.id, qty: 2 }],
  paymentMethod: "เงินสด",
});
db.close();
const csvPath = path.join(dir, "opening.csv");
fs.writeFileSync(
  csvPath,
  "\uFEFFบาร์โค้ด,ชื่อสินค้า,ราคาขาย,สต็อกคงเหลือ\n00001,Opening stock fixture,5,100\n"
);
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const value = probe.address().port;
    probe.close(() => resolve(value));
  });
});
const baseUrl = `http://127.0.0.1:${port}`;
const log = fs.openSync(path.join(dir, "server.log"), "a");
const server = spawn(process.execPath, ["dist/index.js"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    SEED_DEMO_DATA: "0",
    PORT: String(port),
    SQLITE_DB_PATH: target,
    SQLITE_BACKUP_DIR: path.join(dir, "backups"),
  },
  stdio: ["ignore", log, log],
});
let browser, page;
const errors = [];
function all(sql, ...args) {
  const connection = new DatabaseSync(target, { readOnly: true });
  try {
    connection.exec("PRAGMA busy_timeout=5000");
    return connection.prepare(sql).all(...args);
  } finally {
    connection.close();
  }
}
function history() {
  return [
    "sales",
    "sale_items",
    "sale_lot_allocations",
    "members",
    "member_transactions",
  ].map(table => all(`SELECT * FROM ${table} ORDER BY id`));
}
function stock() {
  return [
    all("SELECT stock FROM products WHERE id=?", product.id)[0].stock,
    all(
      "SELECT SUM(qty) AS qty FROM stock_lots WHERE product_id=?",
      product.id
    )[0].qty,
  ];
}
async function click(text, scope = "body") {
  const handle = await page.evaluateHandle(
    ({ text, scope }) =>
      [...document.querySelectorAll(`${scope} button`)].find(
        b => b.getClientRects().length && b.innerText.includes(text)
      ),
    { text, scope }
  );
  assert.ok(handle.asElement(), `Missing button ${text}`);
  await handle.asElement().click();
  await handle.dispose();
}
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(baseUrl)).ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewport({ width: 1366, height: 768 });
  await page.setCookie({
    name: "app_session_id",
    value: session.sessionId,
    url: baseUrl,
  });
  await page.goto(baseUrl, { waitUntil: "networkidle2" });
  await page.waitForSelector(".app-shell");
  await page.click('[data-nav-item="settings"]');
  await page.waitForSelector(".settings-nav");
  await click("ระบบและความปลอดภัย");
  await click("นำเข้าข้อมูล", ".settings-nav");
  await click("สินค้าและสต็อก", ".import-kind-grid");
  const input = await page.$('input[type="file"][accept=".xlsx,.xls,.csv"]');
  assert.ok(input);
  await input.uploadFile(csvPath);
  await page.waitForSelector(".import-run-row");
  assert.equal(
    await page.$eval(
      '[aria-label="ความหมายของจำนวนสต็อก"] [aria-checked="true"]',
      b => b.textContent.includes("ยอดตั้งต้นก่อนขายวันนี้")
    ),
    true
  );
  const before = history();
  await click("ตรวจสอบยอดก่อนนำเข้า", ".import-run-row");
  await page.waitForSelector(".opening-stock-review");
  assert.deepEqual(
    await page.$$eval(".opening-stock-table tbody tr:first-child td", cells =>
      cells.slice(1).map(c => Number(c.textContent))
    ),
    [100, 2, 98]
  );
  assert.deepEqual(stock(), [48, 48]);
  assert.deepEqual(history(), before);
  await page.screenshot({ path: path.join(dir, "opening-preview.png") });
  await click("กลับไปแก้ไข", ".opening-stock-review");
  await page.waitForFunction(
    () => !document.querySelector(".opening-stock-review")
  );
  assert.deepEqual(stock(), [48, 48]);
  await click("ตรวจสอบยอดก่อนนำเข้า", ".import-run-row");
  await page.waitForSelector(".opening-stock-review");
  await click("ยืนยันนำเข้ายอดตั้งต้น", ".opening-stock-review");
  await page.waitForSelector(".import-result-card");
  assert.deepEqual(stock(), [98, 98]);
  assert.deepEqual(history(), before);
  assert.equal(
    all("SELECT cost FROM products WHERE id=?", product.id)[0].cost,
    0
  );
  assert.ok(
    fs.readdirSync(path.join(dir, "backups")).length,
    "Backup exists before applying"
  );
  await page.waitForSelector(".feedback-dialog:not(.opening-stock-review)");
  await click("ตกลง", ".feedback-dialog");
  await page.waitForFunction(() => !document.querySelector(".feedback-dialog"));
  // Repeat the same file: set the target again, never subtract from the previous target.
  await click("ตรวจสอบยอดก่อนนำเข้า", ".import-run-row");
  await page.waitForSelector(".opening-stock-review");
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(dir, "opening-preview-mobile.png") });
  assert.equal(
    await page.$eval(".opening-stock-review", e => {
      const r = e.getBoundingClientRect();
      return (
        r.left >= 0 &&
        r.right <= innerWidth &&
        r.top >= 0 &&
        r.bottom <= innerHeight
      );
    }),
    true
  );
  await click("ยืนยันนำเข้ายอดตั้งต้น", ".opening-stock-review");
  await page.waitForFunction(
    () => !document.querySelector(".opening-stock-review")
  );
  assert.deepEqual(stock(), [98, 98]);
  assert.deepEqual(history(), before);
  assert.deepEqual(all("PRAGMA foreign_key_check"), []);
  assert.equal(all("PRAGMA integrity_check")[0].integrity_check, "ok");
  assert.deepEqual(errors, []);
  console.log("OPENING_STOCK_IMPORT_PASS", dir);
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(dir, "failure.png"), fullPage: true })
      .catch(() => {});
  console.error("Evidence:", dir);
  throw error;
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    const stopped = new Promise(resolve => server.once("exit", resolve));
    server.kill();
    await stopped;
  }
  fs.closeSync(log);
}
