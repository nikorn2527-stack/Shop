import type { AsyncUnitOfWork } from "../repositories/asyncUnitOfWork";

/** Structural transport contract, compatible with a pg PoolClient. This module
 * does not install a driver, open a database or choose an application provider.
 */
export type PgQueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number | null;
};
export interface PgTransactionConnection {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  release(error?: Error | boolean): void;
}
export interface PgTransactionPool {
  connect(): Promise<PgTransactionConnection>;
}
export interface ScopedPgQueries {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
}

export class TransactionScopeClosedError extends Error {
  readonly code = "TRANSACTION_SCOPE_CLOSED";
  constructor() {
    super(
      "The transaction callback has finished; its repository cannot be reused",
    );
    this.name = "TransactionScopeClosedError";
  }
}

export class UnawaitedTransactionQueryError extends Error {
  readonly code = "TRANSACTION_QUERIES_NOT_AWAITED";
  constructor() {
    super("Every transaction query must finish before its callback returns");
    this.name = "UnawaitedTransactionQueryError";
  }
}

/** COMMIT may have reached the server even if its response was lost. A caller
 * must resolve its request ID against the database before attempting a write
 * again. There is deliberately no automatic retry in this unit of work.
 */
export class TransactionCommitUnknownError extends Error {
  readonly code = "TRANSACTION_COMMIT_UNKNOWN";
  constructor(cause: unknown) {
    super(
      "Cannot confirm whether the transaction committed; resolve the request ID before retrying",
      { cause },
    );
    this.name = "TransactionCommitUnknownError";
  }
}

type TransactionOptions = {
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
};
const CONFIG_SQL =
  "SELECT set_config('TimeZone', $1, true), set_config('statement_timeout', $2, true), set_config('lock_timeout', $3, true)";

function connectionError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Transaction connection cannot be safely reused", {
        cause: error,
      });
}

function queryScope(client: PgTransactionConnection) {
  let active = true;
  const pending = new Set<Promise<PgQueryResult>>();
  const failures: unknown[] = [];
  const queries: ScopedPgQueries = {
    query(text, values) {
      if (!active) return Promise.reject(new TransactionScopeClosedError());
      // Invoke inside a promise so a synchronous driver failure is tracked too.
      const operation = Promise.resolve().then(() =>
        client.query(text, values),
      );
      pending.add(operation);
      void operation.then(
        () => pending.delete(operation),
        (error) => {
          pending.delete(operation);
          failures.push(error);
        },
      );
      return operation;
    },
  };
  return {
    queries,
    pendingCount: () => pending.size,
    seal: () => {
      active = false;
    },
    firstFailure: () => (failures.length ? { error: failures[0] } : undefined),
    drain: async () => {
      await Promise.allSettled(Array.from(pending));
    },
  };
}

export function createPostgresUnitOfWork<Repository>(
  pool: PgTransactionPool,
  repositoryFor: (queries: ScopedPgQueries) => Repository,
  options: TransactionOptions = {},
): AsyncUnitOfWork<Repository> {
  const statementTimeoutMs = options.statementTimeoutMs ?? 10_000;
  const lockTimeoutMs = options.lockTimeoutMs ?? 3_000;
  if (
    !Number.isSafeInteger(statementTimeoutMs) ||
    statementTimeoutMs < 1 ||
    statementTimeoutMs > 120_000
  )
    throw new RangeError(
      "statementTimeoutMs must be an integer from 1 to 120000",
    );
  if (
    !Number.isSafeInteger(lockTimeoutMs) ||
    lockTimeoutMs < 1 ||
    lockTimeoutMs > statementTimeoutMs
  )
    throw new RangeError(
      "lockTimeoutMs must be a positive integer no greater than statementTimeoutMs",
    );

  return {
    async transaction<T>(
      work: (repository: Repository) => Promise<T>,
    ): Promise<T> {
      const client = await pool.connect();
      let began = false;
      let discard: Error | undefined;
      let scope: ReturnType<typeof queryScope> | undefined;
      try {
        await client.query("BEGIN");
        began = true;
        await client.query(CONFIG_SQL, [
          "Asia/Bangkok",
          `${statementTimeoutMs}ms`,
          `${lockTimeoutMs}ms`,
        ]);
        scope = queryScope(client);
        const result = await work(repositoryFor(scope.queries));
        const unfinished = scope.pendingCount() > 0;
        scope.seal();
        // Never issue ROLLBACK/COMMIT or release a client while an already
        // submitted query is still running on that connection.
        await scope.drain();
        const failure = scope.firstFailure();
        if (failure) throw failure.error;
        if (unfinished) throw new UnawaitedTransactionQueryError();
        try {
          await client.query("COMMIT");
        } catch (error) {
          discard = connectionError(error);
          throw new TransactionCommitUnknownError(error);
        }
        began = false;
        return result;
      } catch (error) {
        scope?.seal();
        await scope?.drain();
        if (began) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            discard = connectionError(rollbackError);
            throw new AggregateError(
              [error, rollbackError],
              "Transaction failed and rollback could not be confirmed",
              { cause: error },
            );
          }
        } else {
          discard = connectionError(error);
        }
        throw error;
      } finally {
        client.release(discard);
      }
    },
  };
}
