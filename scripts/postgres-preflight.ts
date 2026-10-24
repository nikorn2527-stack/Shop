import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { inspectPostgresSource } from "../server/postgresPreflight";

try {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      'Read-only inventory, not a PostgreSQL migration.\nUsage: pnpm db:postgres:preflight --source "path/to/verified-backup.sqlite" [--out "migration-reports/preflight.json"]'
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
        throw new Error(
          "Use --source <existing snapshot> and optional --out <new report>"
        );
      options.set(args[i], args[i + 1]);
    }
    if (!options.has("--source"))
      throw new Error("--source is required; no default database is opened");
    const source = resolve(options.get("--source")!);
    const output = options.get("--out") ? resolve(options.get("--out")!) : null;
    if (output === source)
      throw new Error("Output cannot be the source database");
    const report = inspectPostgresSource(source),
      json = JSON.stringify(report, null, 2) + "\n";
    if (output) {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, json, { flag: "wx", mode: 0o600 });
      console.log(
        `Preflight report written. Source checks: ${report.sourceChecksPassed ? "passed" : "blocked"}. PostgreSQL runtime is not implemented.`
      );
    } else process.stdout.write(json);
    if (!report.sourceChecksPassed) process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
