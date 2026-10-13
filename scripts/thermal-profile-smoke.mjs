import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync, backup } from "node:sqlite";
import puppeteer from "puppeteer";
import { createAppSession, setSettings } from "../server/sqliteStore.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thermal-profile-"));
const dbPath = path.join(dir, "test.sqlite");
const source = new DatabaseSync(path.resolve("data/welfare-store.sqlite"), { readOnly: true });
await backup(source, dbPath);
source.close();
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') LIMIT 1").get();
assert.ok(user, "need admin");
const session = createAppSession(db, user.id);
setSettings(db, { receiptPaperWidth: "72" });
db.close();

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, () => { const value = probe.address().port; probe.close(() => resolve(value)); });
});
const log = fs.openSync(path.join(dir, "server.log"), "a");
const server = spawn(process.execPath, ["dist/index.js"], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(port), SQLITE_DB_PATH: dbPath, SEED_DEMO_DATA: "0" },
  stdio: ["ignore", log, log],
});
let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let index = 0; index < 60; index += 1) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (index === 59) throw new Error("Server not ready");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewport({ width: 1366, height: 900 });
  await page.setCookie({ name: "app_session_id", value: session.sessionId, url });
  await page.goto(url, { waitUntil: "networkidle2" });
  await page.click("[data-nav-item=settings]");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.includes("ใบเสร็จ")));
  await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.includes("ใบเสร็จ"))?.click());
  await page.waitForSelector(".thermal-paper-settings");
  assert.equal(await page.$$eval(".thermal-preset-grid > button", nodes => nodes.length), 3);
  assert.equal(await page.$eval(".thermal-preset-grid > button.selected", node => node.textContent.includes("72 มม.")), true);
  await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.includes("ปรับให้ตรงกับเครื่องพิมพ์นี้"))?.click());
  await page.waitForSelector(".thermal-calibration-grid");
  const fields = await page.$$(".thermal-calibration-grid input");
  assert.equal(fields.length, 3);
  await fields[0].click();
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await fields[0].type("66");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--thermal-printable-width") === "66mm");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("thermal-print-profiles-v1")).__workstation__["72"].printableWidthMm), 66);
  await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.includes("พิมพ์แผ่นทดสอบ"))?.click());
  await page.waitForSelector(".print-preview-modal");
  assert.equal(await page.$eval("#printer-test-slip", node => node.textContent.includes("พื้นที่พิมพ์ 66 มม.")), true);
  const overflow = await page.$eval(".thermal-paper-settings", node => node.scrollWidth > node.clientWidth + 1);
  assert.equal(overflow, false, "desktop settings must not overflow");
  await page.screenshot({ path: path.join(dir, "thermal-profile-desktop.png"), fullPage: true });
  await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.getAttribute("aria-label")?.includes("ปิดหน้าต่างพรีวิว"))?.click());
  await page.setViewport({ width: 390, height: 844 });
  const mobileOverflow = await page.$eval(".thermal-paper-settings", node => node.scrollWidth > node.clientWidth + 1);
  assert.equal(mobileOverflow, false, "mobile settings must not overflow");
  await page.screenshot({ path: path.join(dir, "thermal-profile-mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("THERMAL_PROFILE_UI_PASS", dir);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}