/** Async providers must keep one checked-out connection for the whole callback.
 * The callback must await every repository operation and never print or call
 * external services while holding this transaction.
 */
export interface AsyncUnitOfWork<Repository> {
  transaction<T>(work: (repository: Repository) => Promise<T>): Promise<T>;
}
