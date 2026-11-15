import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  assignMemberCard,
  closeMemberAccount,
  createBlankCards,
  createSqliteStore,
  ensureRbacSeed,
  markPhysicalCard,
  registerMember,
  type SqliteDb,
} from "./sqliteStore";
const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./welfareStore", () => ({
  getWelfareDb: store.get,
  getWelfareDbPath: () => "unused-test.sqlite",
  getBackupDir: () => "unused-test-backups",
  closeWelfareDb: vi.fn(),
}));
import { appRouter } from "./routers";
let db: SqliteDb;
beforeEach(() => {
  db = createSqliteStore();
  ensureRbacSeed(db);
  store.get.mockReturnValue(db);
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.clearAllMocks();
});
function api(appRole = "cashier") {
  return appRouter.createCaller({
    user: {
      id: 1,
      name: "Cashier",
      role: "user",
      appRole,
    } as TrpcContext["user"],
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}
function fixture(amount = 100) {
  createBlankCards(db, ["RETURN-REPLAY"]);
  const member = registerMember(db, {
    firstName: "Return",
    lastName: "Replay",
    cardNumber: "RETURN-REPLAY",
    ...(amount ? { initialDeposit: amount } : {}),
  }).member;
  const session = db
    .prepare(
      "SELECT id FROM card_usage_sessions WHERE member_number=? AND ended_at IS NULL"
    )
    .get(member.memberNumber)!;
  return {
    memberNumber: member.memberNumber,
    cardNumber: "RETURN-REPLAY",
    expectedSessionId: Number(session.id),
    mode: "refund" as const,
    clientRequestId: "return-original-request",
  };
}
function state() {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return tables.map(({ name }) => [
    name,
    db
      .prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`)
      .all(),
  ]);
}
describe("card.return committed-response recovery", () => {
  it("preserves an exact request key containing surrounding spaces on replay", async () => {
    const input = { ...fixture(), clientRequestId: " spaced-key " };
    const original = await api().card.return(input);
    const before = state();
    expect(await api().card.return(input)).toEqual(original);
    expect(state()).toEqual(before);
  });
  it.each([100, 0])(
    "recovers a committed %s return without any additional business, audit, or sequence writes",
    async amount => {
      const input = fixture(amount);
      const original = await api().card.return(input);
      const before = state();
      expect(await api().card.return(input)).toEqual(original);
      expect(state()).toEqual(before);
      expect(original.slip.amount).toBe(amount);
    }
  );
  it.each(["different-request", undefined, ""])(
    "rejects paid return replay with wrong or missing key %s without writes",
    async key => {
      const input = fixture();
      await api().card.return(input);
      const before = state();
      await expect(
        api().card.return({ ...input, clientRequestId: key })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(state()).toEqual(before);
    }
  );
  it("recovers the original paid return after recycling the card without touching its new holder", async () => {
    const input = fixture();
    const original = await api().card.return(input);
    const newHolder = registerMember(db, {
      firstName: "New",
      lastName: "Holder",
      cardNumber: input.cardNumber,
      initialDeposit: 25,
    }).member;
    const before = state();
    const result = await api().card.return(input);
    expect(result.slip).toEqual(original.slip);
    expect(state()).toEqual(before);
    expect(
      db
        .prepare(
          "SELECT balance,card_number FROM members WHERE member_number=?"
        )
        .get(newHolder.memberNumber)
    ).toMatchObject({ balance: 25, card_number: input.cardNumber });
  });
  it.each(["memberNumber", "cardNumber", "expectedSessionId"] as const)(
    "rejects mismatched replay %s without writes",
    async field => {
      const input = fixture();
      await api().card.return(input);
      const bad = {
        ...input,
        [field]:
          field === "expectedSessionId"
            ? input.expectedSessionId + 999
            : "other-identity",
      };
      const before = state();
      await expect(api().card.return(bad)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(state()).toEqual(before);
    }
  );
  it.each(["lost", "damaged"] as const)(
    "does not replay a %s-card session as a return",
    async status => {
      const input = fixture();
      markPhysicalCard(db, input.cardNumber, status);
      const before = state();
      await expect(api().card.return(input)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(state()).toEqual(before);
    }
  );
  it("does not replay a replaced-card session as a return", async () => {
    const input = fixture();
    createBlankCards(db, ["REPLACEMENT"]);
    assignMemberCard(db, {
      memberNumber: input.memberNumber,
      cardNumber: "REPLACEMENT",
      expectedCardNumber: input.cardNumber,
      expectedSessionId: input.expectedSessionId,
    });
    const before = state();
    await expect(api().card.return(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(state()).toEqual(before);
  });
  it("does not mistake a retain-card closeAccount refund for the later zero card return", async () => {
    const input = fixture();
    closeMemberAccount(db, input);
    const zeroReturn = await api().card.return(input);
    expect(zeroReturn.slip).toMatchObject({
      amount: 0,
      documentRef: {
        kind: "card_return_zero",
        key: String(input.expectedSessionId),
      },
    });
    const before = state();
    expect((await api().card.return(input)).slip).toEqual(zeroReturn.slip);
    expect(state()).toEqual(before);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) n FROM member_transactions WHERE type='refund'"
        )
        .get()?.n
    ).toBe(1);
  });
  it("pairs same-second same-holder recycling to the correct closing release event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
    const input = fixture();
    const paid = await api().card.return(input);
    assignMemberCard(db, {
      memberNumber: input.memberNumber,
      cardNumber: input.cardNumber,
      expectedCardNumber: null,
    });
    const next = db
      .prepare(
        "SELECT id FROM card_usage_sessions WHERE member_number=? AND ended_at IS NULL"
      )
      .get(input.memberNumber)!;
    const zeroInput = {
      ...input,
      expectedSessionId: Number(next.id),
      clientRequestId: "zero-next",
    };
    await api().card.return(zeroInput);
    const before = state();
    expect((await api().card.return(input)).slip).toEqual(paid.slip);
    await expect(
      api().card.return({ ...input, clientRequestId: "wrong-paid-key" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await api().card.return(zeroInput)).slip.amount).toBe(0);
    expect(state()).toEqual(before);
  });
  it("does not broaden permission for a completed replay", async () => {
    const input = fixture();
    await api().card.return(input);
    const before = state();
    await expect(api("viewer").card.return(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(state()).toEqual(before);
  });
});
