// Run after pnpm build. All writes use a fresh /tmp SQLite fixture.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import puppeteer from "puppeteer";
import XLSX from "xlsx";
import {
  createSqliteStore,
  createAppUser,
  createAppSession,
  createProduct,
  receiveStockLines,
  checkout,
  addOrderItem,
  setEditionSettings,
} from "../server/sqliteStore.ts";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-report-valuation-"));
const target = path.join(dir, "fixture.sqlite");
const db = createSqliteStore(target);
const admin = createAppUser(db, {
  username: "report_admin",
  password: "ReportTest!2026",
  displayName: "Report fixture",
  role: "admin",
});
db.prepare("UPDATE app_users SET must_change_password=0 WHERE id=?").run(
  admin.id
);
const session = createAppSession(db, admin.id);
setEditionSettings(db, { trialStart: new Date().toISOString().slice(0, 10) });
const a = createProduct(db, {
  name: "Report A",
  barcode: "VALUE-A",
  price: 20,
  cost: 4,
  stock: 0,
});
const b = createProduct(db, {
  name: "Report B",
  barcode: "VALUE-B",
  price: 15,
  cost: 0,
  stock: 5,
});
receiveStockLines(db, {
  productId: a.id,
  lot: "VALUE-LOT",
  actor: "Report fixture",
  paidAmount: 40,
  lines: [{ qty: 10, cost: 4 }],
});
checkout(db, {
  items: [
    { productId: a.id, qty: 2 },
    { productId: b.id, qty: 1 },
  ],
  paymentMethod: "เงินสด",
});
addOrderItem(db, { productId: a.id, qty: 3 });
addOrderItem(db, { productId: b.id, qty: 2 });
const snapshotTables = [
  "products",
  "stock_lots",
  "sales",
  "sale_items",
  "sale_lot_allocations",
  "member_transactions",
];
const before = snapshotTables.map(table =>
  db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
);
db.close();
const port = await new Promise(resolve => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => {
    const p = probe.address().port;
    probe.close(() => resolve(p));
  });
});
const base = `http://127.0.0.1:${port}`;
const log = fs.openSync(path.join(dir, "server.log"), "a");
const server = spawn(process.execPath, ["dist/index.js"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    SEED_DEMO_DATA: "0",
    PORT: String(port),
    SQLITE_DB_PATH: target,
  },
  stdio: ["ignore", log, log],
});
let browser, page;
const errors = [];
const evidence = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function click(text, scope = "body") {
  const h = await page.evaluateHandle(
    ({ text, scope }) =>
      [...document.querySelectorAll(`${scope} button`)].find(
        e => e.getClientRects().length && e.textContent.includes(text)
      ),
    { text, scope }
  );
  assert.ok(h.asElement(), `Missing ${text}`);
  await h.asElement().click();
  await h.dispose();
}
async function previewRows() {
  const iframe = await page.waitForSelector(".export-preview-modal iframe");
  const frame = await iframe.contentFrame();
  await frame.waitForSelector("table");
  return frame.$$eval("tr", rows =>
    rows.map(r =>
      [...r.querySelectorAll("th,td")].map(c => c.textContent.trim())
    )
  );
}
async function verifyExports(name, verifyRows, expectedTotal) {
  await page.waitForSelector(".export-preview-modal");
  verifyRows(await previewRows(), "preview");
  const downloadDir = path.join(dir, name);
  fs.mkdirSync(downloadDir);
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir,
  });
  for (const [format, ext] of [
    ["csv", ".csv"],
    ["xlsx", ".xlsx"],
    ["pdf", ".pdf"],
  ]) {
    if (!(await page.$(".export-preview-modal"))) {
      await click("ดูพรีวิว");
      await page.waitForSelector(".export-preview-modal");
    }
    await page.click(`.export-preview-modal .format-${format}`);
    let file;
    for (let n = 0; n < 100; n++) {
      file = fs.readdirSync(downloadDir).find(f => f.endsWith(ext));
      if (file) break;
      await pause(100);
    }
    assert.ok(file, `${name} ${format} download`);
    const output = path.join(downloadDir, file);
    const bytes = fs.readFileSync(output);
    if (format === "pdf") {
      const text = execFileSync("pdftotext", ["-layout", output, "-"], {
        encoding: "utf8",
      });
      assert.ok(
        text.includes(expectedTotal.toFixed(2)),
        `${name} PDF includes total ${expectedTotal}`
      );
    } else {
      const workbook = XLSX.read(bytes, { type: "buffer", raw: true });
      verifyRows(
        XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
          header: 1,
          raw: false,
          defval: "",
        }),
        format
      );
    }
  }
  evidence.push(name);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
  if (await page.$('[aria-label="ปิดหน้าต่างพรีวิว"]'))
    await page.click('[aria-label="ปิดหน้าต่างพรีวิว"]');
  await page.waitForFunction(
    () => !document.querySelector(".export-preview-modal")
  );
}
const number = v => Number(String(v).replace(/[฿,\s]/g, ""));
try {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await pause(100);
  }
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  page = await browser.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewport({ width: 1600, height: 1000 });
  await page.setCookie({
    name: "app_session_id",
    value: session.sessionId,
    url: base,
  });
  await page.goto(base, { waitUntil: "networkidle2" });
  await page.waitForSelector(".app-shell");
  await page.click('[data-nav-item="stock"]');
  await page.waitForSelector(".stock-stat");
  assert.ok(
    await page.$eval(".stock-overview", e => e.textContent.includes("220.00")),
    "Screen stock value is 8*20 + 4*15"
  );
  assert.ok(
    await page.$eval(".stock-overview", e => e.textContent.includes("40.0%")),
    "Unknown catalog cost must not appear as a 100% product margin"
  );
  const search = await page.waitForSelector(".shared-search-host input");
  await search.type("Report A");
  await page.waitForFunction(
    () =>
      document.querySelectorAll('tr.clickable[title^="ดูล็อตและจัดการ"]')
        .length === 1
  );
  await click("ดูพรีวิว");
  await verifyExports(
    "inventory-filtered",
    (rows, format) => {
      const row = rows.find(r => r[0] === "Report A");
      assert.ok(row, format);
      if (format === "preview") {
        assert.equal(number(row[3]), 8);
        assert.equal(number(row[4]), 20);
        assert.equal(number(row[5]), 160);
      } else {
        assert.equal(number(row[4]), 8);
        assert.equal(number(row[5]), 20);
        assert.equal(number(row[6]), 160);
      }
      const total = rows.find(r => r[0] === "รวมตามตัวกรอง");
      assert.ok(total, format);
      assert.equal(
        number(total[format === "preview" ? 5 : 6]),
        160,
        "Total matches the filtered row rather than whole inventory"
      );
    },
    160
  );
  await click("รายการสั่งซื้อ", ".stock-workbench .dash-tabbar");
  await page.waitForFunction(() =>
    document.body.textContent.includes("Report B")
  );
  await click("ดูพรีวิว");
  await verifyExports(
    "orders",
    (rows, format) => {
      const row = rows.find(r => r[0] === "Report A");
      assert.ok(row, format);
      assert.equal(number(row[5]), 20);
      assert.equal(number(row[6]), 60);
      const total = rows.find(r => r[0] === "รวม");
      assert.equal(number(total[6]), 90);
    },
    90
  );
  await click("ประวัติรับเข้า", ".stock-workbench .dash-tabbar");
  await page.waitForSelector(".receipt-history-filters");
  assert.ok(
    await page.$eval(".stock-receipt-history", e =>
      e.textContent.includes("200.00")
    )
  );
  await click("ดูพรีวิว", ".stock-receipt-history");
  await verifyExports(
    "receipts",
    (rows, format) => {
      const row = rows.find(r => r[2] === "VALUE-LOT");
      assert.ok(row, format);
      assert.equal(number(row[3]), 10);
      assert.equal(number(row[5]), 20);
      assert.equal(number(row[6]), 200);
    },
    200
  );
  await page.click('[data-nav-item="profit"]');
  await page.waitForSelector(".cost-profit-page");
  await page.waitForFunction(() =>
    document.querySelector(".cost-profit-page")?.textContent.includes("32.00")
  );
  const profitText = await page.$eval(".cost-profit-page", e => e.textContent);
  assert.ok(profitText.includes("32.00"), "Real-cost profit is still 32");
  assert.ok(
    profitText.includes("23.00"),
    "Financial cost is real 8 + unknown-cost fallback 15"
  );
  const afterDb = new DatabaseSync(target, { readOnly: true });
  try {
    assert.deepEqual(
      snapshotTables.map(table =>
        afterDb.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
      ),
      before
    );
  } finally {
    afterDb.close();
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(dir, "results.json"),
    JSON.stringify({ evidence, errors }, null, 2)
  );
  console.log("REPORT_VALUATION_PASS", dir);
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
    const forceStop = setTimeout(() => server.kill("SIGKILL"), 3000);
    await stopped;
    clearTimeout(forceStop);
  }
  fs.closeSync(log);
}
