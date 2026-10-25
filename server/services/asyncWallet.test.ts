import { describe, expect, it, vi } from "vitest";
import type { Member, WalletTxInput } from "../../shared/storeTypes/members";
import type { AsyncWalletRepository } from "../repositories/asyncWalletRepository";
import type { AsyncUnitOfWork } from "../repositories/asyncUnitOfWork";
import type { MemberLedgerInput } from "../repositories/memberLedgerRepository";
import {
  createBlankCards,
  createSqliteStore,
  registerMember,
  walletTx,
} from "../sqliteStore";
import { StoreError } from "../domain/storeError";
import { walletTxAsync, walletTxInAsyncTransaction } from "./asyncWallet";

const runtime = {
  now: () => new Date("2026-10-25T01:00:00Z"),
  formatDateTime: () => "2026-10-25 08:00:00",
};
function fixture(member: Member) {
  let state = {
    member: structuredClone(member),
    ledger: [] as MemberLedgerInput[],
    audits: [] as unknown[],
    released: false,
  };
  let failure: string | undefined;
  const events: string[] = [];
  const step = async (name: string) => {
    await Promise.resolve();
    events.push(name);
    if (failure === name) throw new Error(`failure at ${name}`);
  };
  const repository: AsyncWalletRepository = {
    findWalletByRequestId: vi.fn(async () => undefined),
    findMember: vi.fn(async () => structuredClone(state.member)),
    requireUsableMember: vi.fn(async () => structuredClone(state.member)),
    setMemberBalance: vi.fn(async (_number, value) => {
      await step("balance");
      state.member.balance = value;
    }),
    insertMemberTransaction: vi.fn(async (input) => {
      await step("ledger");
      state.ledger.push(input);
    }),
    releaseCard: vi.fn(async () => {
      await step("release");
      state.member.cardNumber = null;
      state.released = true;
    }),
    appendAudit: vi.fn(async (input) => {
      await step("audit");
      state.audits.push(input);
    }),
  };
  // A rollback-capable test double, not a PostgreSQL database. Transport and
  // connection lifecycle are exercised separately in postgresTransaction.test.
  const unitOfWork: AsyncUnitOfWork<AsyncWalletRepository> = {
    transaction: vi.fn(async (work) => {
      const before = structuredClone(state);
      try {
        const result = await work(repository);
        events.push("commit");
        return result;
      } catch (error) {
        state = before;
        events.push("rollback");
        throw error;
      }
    }),
  };
  return {
    repository,
    unitOfWork,
    events,
    state: () => structuredClone(state),
    fail: (name?: string) => {
      failure = name;
    },
  };
}
function memberFixture() {
  const db = createSqliteStore();
  createBlankCards(db, ["ASYNC-CARD"]);
  const member = registerMember(db, {
    firstName: "Async",
    lastName: "Member",
    cardNumber: "ASYNC-CARD",
    initialDeposit: 100,
  }).member;
  return { db, member };
}

describe("async wallet service (repository contract tests)", () => {
  it.each(["deposit", "withdrawal", "refund"] as const)(
    "keeps %s results equal to the existing SQLite facade",
    async (type) => {
      const { db, member } = memberFixture();
      try {
        const f = fixture(member);
        const input = {
          memberNumber: member.memberNumber,
          type,
          amount: type === "refund" ? 100 : 12.34,
          note: " Test note ",
          actor: " Test actor ",
        };
        const result = await walletTxAsync(f.unitOfWork, input, runtime);
        expect(result).toEqual(walletTx(db, input));
        expect(f.events).toEqual(
          type === "refund"
            ? ["balance", "ledger", "release", "audit", "commit"]
            : ["balance", "ledger", "audit", "commit"],
        );
        expect(f.state().member.balance).toBe(result.balanceAfter);
        expect(f.state().released).toBe(type === "refund");
      } finally {
        db.close();
      }
    },
  );

  it.each(["balance", "ledger", "release", "audit"])(
    "awaits %s errors and leaves rollback to its unit of work",
    async (failure) => {
      const { db, member } = memberFixture();
      try {
        const f = fixture(member),
          before = f.state();
        const input = {
          memberNumber: member.memberNumber,
          type: "refund" as const,
          amount: 100,
        };
        f.fail(failure);
        await expect(
          walletTxAsync(f.unitOfWork, input, runtime),
        ).rejects.toThrow(`failure at ${failure}`);
        expect(f.state()).toEqual(before);
        expect(f.events.at(-1)).toBe("rollback");
        expect(f.events).not.toContain("commit");
        f.fail();
        expect(
          (await walletTxAsync(f.unitOfWork, input, runtime)).balanceAfter,
        ).toBe(0);
      } finally {
        db.close();
      }
    },
  );

  it("replays before checking an already released card and performs no additional write", async () => {
    const { db, member } = memberFixture();
    try {
      const f = fixture(member);
      const input = {
        memberNumber: member.memberNumber,
        type: "refund" as const,
        amount: 100,
        clientRequestId: "async-refund",
      };
      const receipt = await walletTxAsync(f.unitOfWork, input, runtime);
      vi.mocked(f.repository.findWalletByRequestId).mockResolvedValue(receipt);
      const committed = f.state();
      expect(await walletTxAsync(f.unitOfWork, input, runtime)).toEqual(
        receipt,
      );
      expect(f.state()).toEqual(committed);
      expect(f.repository.findMember).toHaveBeenCalledTimes(1);
      expect(f.repository.setMemberBalance).toHaveBeenCalledTimes(1);
      expect(f.repository.insertMemberTransaction).toHaveBeenCalledTimes(1);
      expect(f.repository.releaseCard).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("joins the enclosing async account closure without releasing its retained card", async () => {
    const { db, member } = memberFixture();
    try {
      const f = fixture(member),
        before = f.state();
      const input = {
        memberNumber: member.memberNumber,
        type: "refund" as const,
        amount: 100,
        retainCard: true,
      };
      await expect(
        f.unitOfWork.transaction(async (repository) => {
          expect(
            (await walletTxInAsyncTransaction(repository, input, runtime))
              .balanceAfter,
          ).toBe(0);
          expect(f.repository.releaseCard).not.toHaveBeenCalled();
          throw new Error("closure failed");
        }),
      ).rejects.toThrow("closure failed");
      expect(f.state()).toEqual(before);
      expect(f.unitOfWork.transaction).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("rejects invalid amounts before member lookup and insufficient balances before writing", async () => {
    const { db, member } = memberFixture();
    try {
      const f = fixture(member);
      await expect(
        walletTxAsync(
          f.unitOfWork,
          { memberNumber: member.memberNumber, type: "deposit", amount: 0 },
          runtime,
        ),
      ).rejects.toBeInstanceOf(StoreError);
      expect(f.repository.requireUsableMember).not.toHaveBeenCalled();
      await expect(
        walletTxAsync(
          f.unitOfWork,
          {
            memberNumber: member.memberNumber,
            type: "withdrawal",
            amount: 101,
          },
          runtime,
        ),
      ).rejects.toBeInstanceOf(StoreError);
      expect(f.repository.setMemberBalance).not.toHaveBeenCalled();
      vi.mocked(f.repository.findMember).mockResolvedValue(undefined);
      await expect(
        walletTxAsync(
          f.unitOfWork,
          { memberNumber: "MISSING", type: "refund", amount: 1 },
          runtime,
        ),
      ).rejects.toThrow("ไม่พบสมาชิก");
    } finally {
      db.close();
    }
  });
});
