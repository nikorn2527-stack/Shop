import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSqliteStore,
  getSettings,
  setSettings,
  type SqliteDb,
} from "./sqliteStore";
let db: SqliteDb;
beforeEach(() => {
  db = createSqliteStore();
});
afterEach(() => db.close());
function stored() {
  return JSON.parse(
    (
      db
        .prepare("SELECT value FROM store_settings WHERE key='app_settings'")
        .get() as { value: string }
    ).value
  );
}
describe("PromptPay receiving status", () => {
  it("shows a new shop without a number as off", () => {
    expect(getSettings(db)).toMatchObject({
      promptpayId: "",
      promptpayActive: false,
    });
  });
  it("clearing the number alone also persists off and preserves bank configuration", () => {
    setSettings(db, {
      promptpayId: "0812345678",
      promptpayActive: true,
      paymentQrSource: "bank-one",
      bankAccounts: [
        {
          id: "bank-one",
          bankName: "KTB",
          accountNumber: "1234567890",
          accountName: "Store",
          active: true,
        },
      ],
    });
    const banks = getSettings(db).bankAccounts;
    setSettings(db, { promptpayId: "" });
    expect(stored()).toMatchObject({
      promptpayId: "",
      promptpayActive: false,
      paymentQrSource: "bank-one",
      bankAccounts: banks,
    });
    expect(getSettings(db).promptpayActive).toBe(false);
  });
  it("reads old blank-number settings as off even when their flag is on", () => {
    db.prepare(
      "INSERT INTO store_settings (key,value) VALUES ('app_settings',?)"
    ).run(JSON.stringify({ promptpayId: "   ", promptpayActive: true }));
    expect(getSettings(db).promptpayActive).toBe(false);
    setSettings(db, { storeName: "Updated" });
    expect(stored().promptpayActive).toBe(false);
  });
  it("preserves legacy activation when an existing number has no explicit active flag", () => {
    db.prepare(
      "INSERT INTO store_settings (key,value) VALUES ('app_settings',?)"
    ).run(JSON.stringify({ promptpayId: "0812345678" }));
    expect(getSettings(db).promptpayActive).toBe(true);
  });
  it("does not enable a missing number and retains explicit off for a valid number", () => {
    setSettings(db, { promptpayActive: true });
    expect(stored().promptpayActive).toBe(false);
    setSettings(db, { promptpayId: "0812345678", promptpayActive: false });
    expect(getSettings(db).promptpayActive).toBe(false);
    setSettings(db, { promptpayActive: true });
    expect(getSettings(db).promptpayActive).toBe(true);
    setSettings(db, { promptpayId: "", promptpayActive: false });
    expect(getSettings(db).promptpayActive).toBe(false);
  });
});
