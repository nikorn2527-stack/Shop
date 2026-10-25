import { exportPostgresSnapshot } from "../server/database/postgresSnapshot";
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Offline rehearsal only; does not switch the Shop database.\nUsage: pnpm db:postgres:export --source <verified-snapshot.sqlite> --out <new-private-file.sql>"
    );
  } else {
    const options = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      if (
        !["--source", "--out"].includes(args[i]) ||
        !args[i + 1] ||
        args[i + 1].startsWith("--") ||
        options.has(args[i])
      )
        throw new Error("Specify --source and --out once each");
      options.set(args[i], args[i + 1]);
    }
    if (!options.get("--source") || !options.get("--out"))
      throw new Error(
        "Explicit --source and --out are required; no default database is opened"
      );
    const result = exportPostgresSnapshot(
      options.get("--source")!,
      options.get("--out")!
    );
    console.log(
      `Private rehearsal SQL created for ${Object.keys(result.tables).length} tables. Source remains unchanged. PostgreSQL application provider is not ready.`
    );
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "PostgreSQL export failed"
  );
  process.exitCode = 1;
}
