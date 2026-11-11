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
  writeFileSync(join(root, "dist/index.js"), "require('node:fs').writeFileSync('received-env.json', JSON.stringify({db:process.env.SQLITE_DB_PATH,backup:process.env.SQLITE_BACKUP_DIR,seed:process.env.SEED_DEMO_DATA,mode:process.env.NODE_ENV,tz:process.env.TZ,channel:process.env.SHOP_RELEASE_CHANNEL,secret:process.env.JWT_SECRET.length}));");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function run(...args: string[]) {
  return runNode([], ...args);
}
function runNode(nodeArgs: string[], ...args: string[]) {
  return spawnSync(process.execPath, [...nodeArgs, join(root, "scripts/lan-test.mjs"), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, SQLITE_DB_PATH: join(root, "BUSINESS-DO-NOT-OPEN.sqlite"), SQLITE_BACKUP_DIR: join(root, "BUSINESS-BACKUPS"), SEED_DEMO_DATA: "1" }, timeout: 10000 });
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
    expect(JSON.parse(readFileSync(join(root, "received-env.json"), "utf8"))).toMatchObject({ db: join(root, ".lan-test/store.sqlite"), backup: join(root, ".lan-test/backups"), seed: "0", mode: "production", tz: "Asia/Bangkok", channel: "windows-final", secret: 96 });
    expect(existsSync(join(root, "BUSINESS-DO-NOT-OPEN.sqlite"))).toBe(false);
  });
  it("runs customer trial policy on the same isolated database when --live is explicit", () => {
    expect(run("--prepare", "--port", "43003").status).toBe(0);
    const result = run("--live"); expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "received-env.json"), "utf8"))).toMatchObject({ db: join(root, ".lan-test/store.sqlite"), channel: "railway-live", seed: "0" });
    expect(existsSync(join(root, "BUSINESS-DO-NOT-OPEN.sqlite"))).toBe(false);
  });
  it.each([false, true])("starts the isolated app when LAN address discovery fails (live=%s)", live => {
    const preload = join(root, "network-unavailable.cjs");
    writeFileSync(preload, "require('node:os').networkInterfaces = () => { throw new Error('uv_interface_addresses unavailable'); };");
    expect(run("--prepare", "--port", "43004").status).toBe(0);
    const result = runNode(["--require", preload], ...(live ? ["--live"] : []));
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("LAN addresses could not be listed");
    expect(result.stdout).toContain("Main machine: http://localhost:43004");
    expect(JSON.parse(readFileSync(join(root, "received-env.json"), "utf8"))).toMatchObject({
      db: join(root, ".lan-test/store.sqlite"), backup: join(root, ".lan-test/backups"),
      seed: "0", channel: live ? "railway-live" : "windows-final",
    });
    const config = JSON.parse(readFileSync(join(root, ".lan-test/config.json"), "utf8"));
    expect(result.stdout + result.stderr).not.toContain(config.secret);
    expect(existsSync(join(root, "BUSINESS-DO-NOT-OPEN.sqlite"))).toBe(false);
  });
  it("still lists external IPv4 addresses when discovery succeeds", () => {
    const preload = join(root, "network-available.cjs");
    writeFileSync(preload, "require('node:os').networkInterfaces = () => ({eth0: [{family: 'IPv4', address: '192.0.2.10', internal: false}, {family: 'IPv6', address: '2001:db8::1', internal: false}], lo: [{family: 'IPv4', address: '127.0.0.1', internal: true}]});");
    expect(run("--prepare", "--port", "43005").status).toBe(0);
    const result = runNode(["--require", preload], "--https");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Client browsers: https://192.0.2.10:43005");
    expect(result.stdout).not.toContain("Client browsers: https://127.0.0.1");
    expect(result.stdout).not.toContain("2001:db8");
    expect(result.stderr).not.toContain("LAN addresses could not be listed");
    expect(existsSync(join(root, "received-env.json"))).toBe(true);
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
