import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";

describe("member card capture with cold browser font resources", () => {
  let server: Server;
  let browser: Browser;
  let base: string;
  let script: string;
  beforeAll(async () => {
    script = (await build({ entryPoints: ["client/src/lib/captureMemberCard.ts"], bundle: true, write: false, format: "iife", globalName: "CardCapture", platform: "browser" })).outputFiles[0].text;
    server = createServer(async (request, response) => {
      const name = request.url?.match(/^\/fonts\/(Sarabun-\d+-(?:thai|latin)\.woff2)$/)?.[1];
      if (name) {
        response.setHeader("Content-Type", "font/woff2");
        response.end(await readFile(`client/public/fonts/${name}`));
      } else response.end("<!doctype html><html><body></body></html>");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await puppeteer.launch({ executablePath: existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined, headless: true, args: ["--no-sandbox"] });
  }, 30000);
  afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });

  it("includes regular Thai text on the first capture and matches repeated captures", async () => {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      await page.goto(base);
      await page.setContent(`<div id="card" style="width:342.4px;height:215.92px;background:white;color:black;font:400 14px Sarabun"><b style="display:block;padding-top:20px;font-weight:700">ตัวอย่าง สมาชิก ทดสอบ</b><span style="display:block;margin-top:60px">บัตร 0000123456789 · สมาชิก</span></div>`);
      await page.addStyleTag({ content: [400, 600, 700].flatMap(weight => ["thai", "latin"].map(subset => `@font-face{font-family:Sarabun;font-weight:${weight};src:url('/fonts/Sarabun-${weight}-${subset}.woff2');unicode-range:${subset === "thai" ? "U+0E01-0E5B" : "U+0000-00FF"}}`)).join("\n") });
      await page.addScriptTag({ content: script });
      const result = await page.evaluate(async () => {
        await document.fonts.load("400 14px Sarabun", "สมาชิก");
        await document.fonts.load("700 14px Sarabun", "สมาชิก");
        const capture = (window as any).CardCapture.captureMemberCard;
        const element = document.getElementById("card")!;
        const first: HTMLCanvasElement = await capture(element);
        const second: HTMLCanvasElement = await capture(element);
        const data = first.getContext("2d")!.getImageData(0, 350, first.width, 200).data;
        let darkPixels = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 100) darkPixels++;
        return { first: first.toDataURL(), second: second.toDataURL(), width: first.width, height: first.height, darkPixels };
      });
      expect(result.width).toBe(1370);
      expect(result.height).toBe(864);
      expect(result.darkPixels).toBeGreaterThan(300);
      expect(result.first === result.second).toBe(true);
    } finally { await context.close(); }
  }, 30000);
});
