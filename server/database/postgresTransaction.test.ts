import { describe, expect, it, vi } from "vitest";
import {
  createPostgresUnitOfWork,
  TransactionCommitUnknownError,
  TransactionScopeClosedError,
  UnawaitedTransactionQueryError,
  type PgTransactionConnection,
  type ScopedPgQueries,
} from "./postgresTransaction";

const empty = () => ({ rows: [], rowCount: 0 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(
  fail?: (sql: string) => Promise<ReturnType<typeof empty>> | undefined,
) {
  const client: PgTransactionConnection = {
    query: vi.fn(async (sql) => (await fail?.(sql)) ?? empty()),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };
  const unitOfWork = createPostgresUnitOfWork(pool, (queries) => queries);
  const statements = () =>
    vi.mocked(client.query).mock.calls.map((call) => call[0]);
  return { client, pool, unitOfWork, statements };
}

describe("async PostgreSQL transaction lifecycle (transport contract tests)", () => {
  it("holds one connection until awaited work and COMMIT finish", async () => {
    const f = fixture();
    const result = await f.unitOfWork.transaction(async (repository) => {
      expect(f.client.release).not.toHaveBeenCalled();
      await repository.query("WRITE", [12]);
      await repository.query("READ");
      return { ok: true };
    });
    expect(result).toEqual({ ok: true });
    expect(f.pool.connect).toHaveBeenCalledTimes(1);
    expect(f.statements()).toEqual([
      "BEGIN",
      expect.stringContaining("set_config"),
      "WRITE",
      "READ",
      "COMMIT",
    ]);
    expect(f.client.query).toHaveBeenNthCalledWith(2, expect.any(String), [
      "Asia/Bangkok",
      "10000ms",
      "3000ms",
    ]);
    expect(f.client.release).toHaveBeenCalledTimes(1);
    expect(f.client.release).toHaveBeenCalledWith(undefined);
  });

  it("rolls back an async business failure and preserves its identity", async () => {
    const f = fixture();
    const error = new Error("business failure");
    await expect(
      f.unitOfWork.transaction(async (repository) => {
        await repository.query("WRITE");
        await Promise.resolve();
        throw error;
      }),
    ).rejects.toBe(error);
    expect(f.statements().at(-1)).toBe("ROLLBACK");
    expect(f.statements()).not.toContain("COMMIT");
    expect(f.client.release).toHaveBeenCalledTimes(1);
    expect(f.client.release).toHaveBeenCalledWith(undefined);
  });

  it("rolls back query failures even if callback code catches the rejection", async () => {
    const error = new Error("query failed");
    const f = fixture(async (sql) => {
      if (sql === "FAIL") throw error;
      return empty();
    });
    await expect(
      f.unitOfWork.transaction(async (repository) => {
        await repository.query("FAIL").catch(() => undefined);
        return "should not commit";
      }),
    ).rejects.toBe(error);
    expect(f.statements().at(-1)).toBe("ROLLBACK");
    expect(f.statements()).not.toContain("COMMIT");
  });

  it("drains unawaited queries before rollback and does not return their result as success", async () => {
    const started = deferred<void>();
    const finish = deferred<ReturnType<typeof empty>>();
    const f = fixture((sql) => {
      if (sql === "SLOW") {
        started.resolve();
        return finish.promise;
      }
    });
    const operation = f.unitOfWork.transaction(async (repository) => {
      void repository.query("SLOW");
      return 7;
    });
    const rejected = expect(operation).rejects.toBeInstanceOf(
      UnawaitedTransactionQueryError,
    );
    await started.promise;
    expect(f.client.release).not.toHaveBeenCalled();
    expect(f.statements()).not.toContain("ROLLBACK");
    finish.resolve(empty());
    await rejected;
    expect(f.statements().at(-1)).toBe("ROLLBACK");
    expect(f.client.release).toHaveBeenCalledTimes(1);
  });

  it("waits for outstanding queries before rolling back a failed callback", async () => {
    const started = deferred<void>();
    const finish = deferred<ReturnType<typeof empty>>();
    const f = fixture((sql) => {
      if (sql === "SLOW") {
        started.resolve();
        return finish.promise;
      }
    });
    const error = new Error("callback failed");
    const operation = f.unitOfWork.transaction(async (repository) => {
      void repository.query("SLOW");
      throw error;
    });
    const rejected = expect(operation).rejects.toBe(error);
    await started.promise;
    expect(f.client.release).not.toHaveBeenCalled();
    finish.resolve(empty());
    await rejected;
    expect(f.statements().at(-1)).toBe("ROLLBACK");
  });

  it("rejects use of a leaked repository after its transaction ends", async () => {
    const f = fixture();
    let leaked!: ScopedPgQueries;
    await f.unitOfWork.transaction(async (repository) => {
      leaked = repository;
      return null;
    });
    const before = f.statements();
    await expect(leaked.query("LATE WRITE")).rejects.toBeInstanceOf(
      TransactionScopeClosedError,
    );
    expect(f.statements()).toEqual(before);
  });

  it("discards a connection whose BEGIN result cannot be confirmed", async () => {
    const error = new Error("begin failed");
    const f = fixture(async (sql) => {
      if (sql === "BEGIN") throw error;
      return empty();
    });
    const work = vi.fn(async () => 1);
    await expect(f.unitOfWork.transaction(work)).rejects.toBe(error);
    expect(work).not.toHaveBeenCalled();
    expect(f.statements()).toEqual(["BEGIN"]);
    expect(f.client.release).toHaveBeenCalledTimes(1);
    expect(f.client.release).toHaveBeenCalledWith(error);
  });

  it("rolls back a configuration or repository construction failure", async () => {
    const error = new Error("factory failed");
    const f = fixture();
    const unitOfWork = createPostgresUnitOfWork(f.pool, () => {
      throw error;
    });
    await expect(unitOfWork.transaction(async () => 1)).rejects.toBe(error);
    expect(f.statements().at(-1)).toBe("ROLLBACK");
    const g = fixture(async (sql) => {
      if (sql.includes("set_config")) throw error;
      return empty();
    });
    await expect(g.unitOfWork.transaction(async () => 1)).rejects.toBe(error);
    expect(g.statements().at(-1)).toBe("ROLLBACK");
  });

  it("preserves primary and rollback errors and discards an unsafe connection", async () => {
    const primary = new Error("write failed"),
      rollback = new Error("rollback failed");
    const f = fixture(async (sql) => {
      if (sql === "ROLLBACK") throw rollback;
      return empty();
    });
    const result = await f.unitOfWork
      .transaction(async () => {
        throw primary;
      })
      .catch((error) => error);
    expect(result).toBeInstanceOf(AggregateError);
    expect(result.errors).toEqual([primary, rollback]);
    expect(result.cause).toBe(primary);
    expect(f.client.release).toHaveBeenCalledTimes(1);
    expect(f.client.release).toHaveBeenCalledWith(rollback);
  });

  it("treats a lost COMMIT response as unknown and never automatically retries", async () => {
    const error = new Error("connection lost");
    const f = fixture(async (sql) => {
      if (sql === "COMMIT") throw error;
      return empty();
    });
    const work = vi.fn(async (repository) => {
      await repository.query("WRITE");
      return 1;
    });
    const result = await f.unitOfWork.transaction(work).catch((error) => error);
    expect(result).toBeInstanceOf(TransactionCommitUnknownError);
    expect(result.cause).toBe(error);
    expect(work).toHaveBeenCalledTimes(1);
    expect(f.pool.connect).toHaveBeenCalledTimes(1);
    expect(f.client.release).toHaveBeenCalledTimes(1);
    expect(f.client.release).toHaveBeenCalledWith(error);
  });

  it("does not release a client when pool acquisition itself fails", async () => {
    const error = new Error("pool unavailable");
    const pool = {
      connect: vi.fn(async () => {
        throw error;
      }),
    };
    await expect(
      createPostgresUnitOfWork(pool, (queries) => queries).transaction(
        async () => 1,
      ),
    ).rejects.toBe(error);
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent transactions on separate checked-out connections", async () => {
    const clients = [fixture().client, fixture().client];
    const pool = {
      connect: vi
        .fn()
        .mockResolvedValueOnce(clients[0])
        .mockResolvedValueOnce(clients[1]),
    };
    const gate = deferred<void>();
    let entered = 0;
    const unitOfWork = createPostgresUnitOfWork(pool, (queries) => queries);
    const run = (label: string) =>
      unitOfWork.transaction(async (repository) => {
        entered++;
        if (entered === 2) gate.resolve();
        await gate.promise;
        await repository.query(label);
        return label;
      });
    expect(await Promise.all([run("FIRST"), run("SECOND")])).toEqual([
      "FIRST",
      "SECOND",
    ]);
    expect(
      vi.mocked(clients[0].query).mock.calls.map((call) => call[0]),
    ).toContain("FIRST");
    expect(
      vi.mocked(clients[0].query).mock.calls.map((call) => call[0]),
    ).not.toContain("SECOND");
    for (const client of clients)
      expect(client.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    { statementTimeoutMs: 0 },
    { statementTimeoutMs: NaN },
    { statementTimeoutMs: 120001 },
    { lockTimeoutMs: 0 },
    { lockTimeoutMs: 10001 },
    { lockTimeoutMs: 0.5 },
  ])(
    "rejects invalid timeout settings before acquiring a connection: %j",
    (options) => {
      const f = fixture();
      expect(() =>
        createPostgresUnitOfWork(f.pool, (queries) => queries, options),
      ).toThrow(RangeError);
      expect(f.pool.connect).not.toHaveBeenCalled();
    },
  );
});
