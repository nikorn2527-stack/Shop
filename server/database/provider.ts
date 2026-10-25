/** Prevents a PostgreSQL configuration from silently opening a SQLite business file.
 * The PostgreSQL provider must remain unavailable until all application paths are ported.
 */
export function requireSqliteProvider(
  env: Record<string, string | undefined> = process.env
) {
  const provider = env.SHOP_DATABASE_PROVIDER?.trim().toLowerCase();
  if (provider && provider !== "sqlite" && provider !== "postgresql") {
    throw new Error("SHOP_DATABASE_PROVIDER must be sqlite or postgresql");
  }
  if (
    provider === "postgresql" ||
    (!provider && /^postgres(?:ql)?:/i.test(env.DATABASE_URL?.trim() ?? ""))
  ) {
    throw new Error(
      "PostgreSQL application provider is not complete. Startup refused; no SQLite fallback. Use SHOP_DATABASE_PROVIDER=sqlite only when intentionally running the SQLite application."
    );
  }
}
