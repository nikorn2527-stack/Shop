import { TRPCError } from "@trpc/server";
import { StoreError } from "../domain/storeError";

function mappedStoreError(error: unknown): unknown {
  return error instanceof StoreError
    ? new TRPCError({ code: "BAD_REQUEST", message: error.message })
    : error;
}

/** Existing synchronous routes keep their synchronous return values. */
export function withStoreErrors<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    throw mappedStoreError(error);
  }
}

/** Catch errors after await too; a synchronous try around a promise cannot. */
export async function withStoreErrorsAsync<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw mappedStoreError(error);
  }
}
