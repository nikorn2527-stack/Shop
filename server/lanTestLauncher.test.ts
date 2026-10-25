import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shop-lan-launch-"));
  for (const folder of ["scripts", "dist", "node_modules"]) mkdirSync(join(root, folder));
  copyFileSync(fileURLToPath(new URL("../scripts/lan-test.mjs", import.meta.url)), join(root, "scripts/lan-test.mjs"));
  writeFileSync(join(root, "dist/index.js"), "require('node:fs').writeFileSync('received-env.json', JSON.stringify({db:process.env.SQLITE_DB_PATH,backup:process.env.SQLITE_BACKUP_DIR,seed:process.env.SEED_DEMO_DATA,mode:process.env.NODE_ENV,tz:process.env.TZ,secret:process.env.JWT_SECRET.length}));");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function run(...args: string[]) {
  return spawnSync(process.execPath, [join(root, "scripts/lan-test.mjs"), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, SQLITE_DB_PATH: join(root, "BUSINESS-DO-NOT-OPEN.sqlite"), SQLITE_BACKUP_DIR: join(root, "BUSINESS-BACKUPS"), SEED_DEMO_DATA: "1" }, timeout: 10000 });
}
describe("isolated LAN test launcher", () => {
  it("checks prerequisites without creating or opening databases", () => {
    const result = run("--check"); expect(result.status).toBe(0); expect(existsSync(join(root, ".lan-test"))).toBe(false);
  });
  it("prepares a persistent test configuration without creating a database or displaying its secret", () => {
    const result = run("--prepare", "--port", "43001"); expect(result.status).toBe(0);
    const config = JSON.parse(readFileSync(join(root, ".lan-test/config.json"), "utf8"));
    expect(config).toMatchObject({ purpose: "shop-lan-test", version: 1, port: 43001 });
    expect(result.stdout).not.toContain(config.secret);
    expect(existsSync(join(root, ".lan-test/store.sqlite"))).toBe(false);
    expect(run("--prepare").status).toBe(0);
    expect(JSON.parse(readFileSync(join(root, ".lan-test/config.json"), "utf8")).secret).toBe(config.secret);
  });
  it("overrides inherited business paths and demo seeding before starting the app", () => {
    expect(run("--prepare", "--port", "43002").status).toBe(0);
    const result = run(); expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "received-env.json"), "utf8"))).toMatchObject({ db: join(root, ".lan-test/store.sqlite"), backup: join(root, ".lan-test/backups"), seed: "0", mode: "production", tz: "Asia/Bangkok", secret: 96 });
    expect(existsSync(join(root, "BUSINESS-DO-NOT-OPEN.sqlite"))).toBe(false);
  });
  it("refuses linked test directories and unmarked existing databases", () => {
    const external = join(root, "external"); mkdirSync(external); symlinkSync(external, join(root, ".lan-test"), "dir");
    expect(run("--prepare").status).not.toBe(0); expect(existsSync(join(external, "config.json"))).toBe(false);
    rmSync(join(root, ".lan-test")); mkdirSync(join(root, ".lan-test")); writeFileSync(join(root, ".lan-test/store.sqlite"), "do not open");
    expect(run("--prepare").status).not.toBe(0);
    expect(readFileSync(join(root, ".lan-test/store.sqlite"), "utf8")).toBe("do not open");
  });
  it("does not create an empty database when asked to back up before setup", () => {
    expect(run("--backup").status).not.toBe(0); expect(existsSync(join(root, ".lan-test/store.sqlite"))).toBe(false);
  });
});
