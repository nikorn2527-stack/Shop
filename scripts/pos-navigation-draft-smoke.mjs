// Fresh demo database only. Never opens or rewrites the business database.
// Run after npm run build: PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node --import tsx scripts/pos-navigation-draft-smoke.mjs
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
  createAppUser,
  createProduct,
  createBlankCards,
  assignMemberCard,
} from "../server/sqliteStore.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-navigation-draft-"));
const target = path.join(dir, "demo.sqlite");
const previous = {
  seed: process.env.SEED_DEMO_DATA,
  mode: process.env.NODE_ENV,
};
process.env.SEED_DEMO_DATA = "1";
process.env.NODE_ENV = "development";
const db = openWelfareStore(target);
setEditionSettings(db, { trialStart: new Date().toISOString().slice(0, 10) });
if (previous.seed === undefined) delete process.env.SEED_DEMO_DATA;
else process.env.SEED_DEMO_DATA = previous.seed;
if (previous.mode === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = previous.mode;
const admin = db
  .prepare("SELECT id FROM app_users WHERE role='admin' LIMIT 1")
  .get();
const session = createAppSession(db, admin.id);
const other = createAppUser(db, {
  username: "draft_qa_other",
  displayName: "Other cashier",
  password: "Draft-QA-User!2026",
  role: "admin",
});
db.prepare("UPDATE app_users SET must_change_password=0 WHERE id=?").run(
  other.id
);
const otherSession = createAppSession(db, other.id);
const product = createProduct(db, {
  name: "Navigation draft product",
  sku: "NAV-DRAFT-QA",
  price: 20,
  stock: 100,
  category: "ของใช้",
  quickPick: 1,
});
const member = db
  .prepare(
    "SELECT member_number FROM members WHERE status='active' AND card_number IS NULL LIMIT 1"
  )
  .get();
createBlankCards(db, ["NAV-DRAFT-MEMBER"], "QA");
assignMemberCard(db, {
  memberNumber: member.member_number,
  cardNumber: "NAV-DRAFT-MEMBER",
  expectedCardNumber: null,
  actor: "QA",
});
const initialSales = db.prepare("SELECT COUNT(*) n FROM sales").get().n;
db.close();
const port = await new Promise(resolve => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => {
    const p = probe.address().port;
    probe.close(() => resolve(p));
  });
});
const url = `http://127.0.0.1:${port}`;
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
const errors = [],
  expectedConsole = [],
  checks = [];
const read = (sql, ...params) => {
  const c = new DatabaseSync(target, { readOnly: true });
  try {
    return { ...c.prepare(sql).get(...params) };
  } finally {
    c.close();
  }
};
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url + "/api/trpc/system.health")).ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", message => {
    if (["error", "warn", "warning"].includes(message.type())) {
      if (
        message.text() ===
        "[API Mutation Error] TRPCClientError: Simulated lost response"
      )
        expectedConsole.push(message.text());
      else errors.push(message.type() + ": " + message.text());
    }
  });
  await page.evaluateOnNewDocument(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (
        window.dropCheckoutForDraftTest &&
        String(args[0] instanceof Request ? args[0].url : args[0]).includes(
          "pos.checkout"
        )
      ) {
        window.dropCheckoutForDraftTest = false;
        await response.clone().text();
        throw new TypeError("Simulated lost response");
      }
      return response;
    };
  });
  await page.setCookie({
    name: "app_session_id",
    value: session.sessionId,
    url,
  });
  await page.goto(url, { waitUntil: "networkidle2" });
  await page.waitForSelector(".app-shell");
  const click = async (text, scope = "body") => {
    await page.waitForFunction(
      (text, scope) =>
        [...document.querySelectorAll(scope + " button")].some(
          n => n.getClientRects().length && n.textContent.trim().includes(text)
        ),
      {},
      text,
      scope
    );
    const h = await page.evaluateHandle(
      (text, scope) =>
        [...document.querySelectorAll(scope + " button")].find(
          n => n.getClientRects().length && n.textContent.trim().includes(text)
        ),
      text,
      scope
    );
    await h.asElement().click();
    await h.dispose();
  };
  const fill = async (selector, value) => {
    await page.click(selector);
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type(selector, String(value));
  };
  const pos = async () => {
    await page.click('[data-nav-item="pos"]');
    await page.waitForSelector(".pos-layout");
  };
  const leave = async (view = "stock") => {
    await page.click(".rail-exit");
    await page.waitForSelector('[data-nav-item="stock"]', { visible: true });
    await page.click(`[data-nav-item="${view}"]`);
  };
  const add = async () => {
    await fill(".scan-hero input", product.sku);
    await page.keyboard.press("Enter");
    await page.waitForSelector('input[id^="bill-qty-"]');
  };
  const snapshot = () =>
    page.evaluate(() => ({
      qty: [...document.querySelectorAll('input[id^="bill-qty-"]')].map(
        e => e.value
      ),
      discount: document.querySelector('[aria-label="ส่วนลด (บาท)"]').value,
      customer: document.querySelector(".pos-customer-row").textContent,
    }));
  await pos();
  await add();
  await fill('input[id^="bill-qty-"]', 3);
  await page.keyboard.press("Enter");
  await fill('[aria-label="ส่วนลด (บาท)"]', "5");
  await fill(".scan-hero input", "NAV-DRAFT-MEMBER");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".member-card-modal");
  await click("ยืนยันใช้กับบิลนี้", ".member-card-modal");
  await page.waitForFunction(
    () => !document.querySelector(".member-card-modal")
  );
  const original = await snapshot();
  assert.deepEqual(original.qty, ["3"]);
  assert.equal(original.discount, "5");
  assert.ok(original.customer.includes(member.member_number));
  for (const view of ["stock", "members", "reports"]) {
    await leave(view);
    await pos();
    assert.deepEqual(await snapshot(), original);
  }
  assert.equal(read("SELECT COUNT(*) n FROM sales").n, initialSales);
  assert.equal(
    read("SELECT stock FROM products WHERE id=?", product.id).stock,
    100
  );
  await page.screenshot({ path: path.join(dir, "draft-restored.png") });
  checks.push(
    "Products, quantity, member and discount survive stock/member/report view switches without a sale or stock write"
  );
  await page.click(".cart-heading .icon-button");
  await click("ยืนยันยกเลิกบิล", ".confirm-modal");
  await page.waitForFunction(() => !document.querySelector(".confirm-modal"));
  await leave();
  await pos();
  assert.deepEqual((await snapshot()).qty, []);
  assert.equal((await snapshot()).discount, "0");
  assert.ok((await snapshot()).customer.includes("ทั่วไป"));
  checks.push(
    "Explicit cancellation clears the entire bill and stays cleared after returning"
  );
  await add();
  await click("เงินสด", ".payment-actions");
  await click("รับตรงยอด", ".pay-confirm-modal");
  await click("ยืนยันการชำระเงิน", ".pay-confirm-modal");
  await page.waitForSelector("#receipt-paper");
  assert.equal(read("SELECT COUNT(*) n FROM sales").n, initialSales + 1);
  assert.deepEqual(
    (await snapshot()).qty,
    [],
    "A paid bill is cleared before the receipt is closed"
  );
  await page.click(".receipt-finish-action");
  await page.waitForFunction(() => !document.querySelector(".receipt-modal"));
  await leave();
  await pos();
  assert.deepEqual((await snapshot()).qty, []);
  checks.push("Completed sale never returns as an unpaid draft");
  // A lost response keeps its idempotency key across unmount/remount, avoiding a duplicate charge.
  await add();
  await click("เงินสด", ".payment-actions");
  await click("รับตรงยอด", ".pay-confirm-modal");
  await page.evaluate(() => {
    window.dropCheckoutForDraftTest = true;
  });
  await click("ยืนยันการชำระเงิน", ".pay-confirm-modal");
  await page.waitForSelector(".blocker-button");
  await page.click(".blocker-button");
  await page.waitForFunction(() => !document.querySelector(".blocker-modal"));
  assert.equal(read("SELECT COUNT(*) n FROM sales").n, initialSales + 2);
  await click("ย้อนกลับแก้ไข", ".pay-confirm-modal");
  await leave();
  await pos();
  assert.deepEqual((await snapshot()).qty, ["1"]);
  await click("เงินสด", ".payment-actions");
  await click("รับตรงยอด", ".pay-confirm-modal");
  await click("ยืนยันการชำระเงิน", ".pay-confirm-modal");
  await page.waitForSelector("#receipt-paper");
  assert.equal(read("SELECT COUNT(*) n FROM sales").n, initialSales + 2);
  assert.equal(
    read("SELECT stock FROM products WHERE id=?", product.id).stock,
    98
  );
  checks.push(
    "Lost checkout response can be retried after navigation without recording another sale"
  );
  await page.click(".receipt-finish-action");
  await page.waitForFunction(() => !document.querySelector(".receipt-modal"));
  await add();
  await leave("dashboard");
  await page.click('[aria-label="ออกจากระบบ"]');
  await page.waitForFunction(() => !document.querySelector(".app-shell"));
  await page.setCookie({
    name: "app_session_id",
    value: otherSession.sessionId,
    url,
  });
  await page.goto(url, { waitUntil: "networkidle2" });
  await page.waitForSelector(".app-shell");
  await pos();
  assert.deepEqual((await snapshot()).qty, []);
  assert.equal((await snapshot()).discount, "0");
  checks.push(
    "A different authenticated user does not inherit the active draft"
  );
  assert.equal(
    expectedConsole.length,
    1,
    "Only the deliberately injected lost-response error is expected"
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        expectedConsole,
        status: "POS_NAVIGATION_DRAFT_PASS",
        url,
        title: await page.title(),
        checks,
        errors,
        evidence: dir,
      },
      null,
      2
    )
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(dir, "failure.png"), fullPage: true })
      .catch(() => {});
    fs.writeFileSync(
      path.join(dir, "dom.txt"),
      await page.$eval("body", n => n.innerText).catch(() => "")
    );
  }
  console.error("Evidence:", dir);
  throw error;
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) server.kill();
  fs.closeSync(log);
}
