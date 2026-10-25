import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  closeSync,
  existsSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
function fileSha256(path: string) {
  const descriptor = openSync(path, "r"),
    hash = createHash("sha256"),
    buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes: number;
    while ((bytes = readSync(descriptor, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, bytes));
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

const canonicalTriggers: Record<string, string> = {
  card_session_assignment:
    "9a39cf34822ace64633ad667bffa0a88e9c96b65b6f5f840a0a798185dc9fe6f",
  member_transactions_created_at_default:
    "7fe0aa679379163d726152d3ae2d0ea50af4a9d97b102ece66711202e54274ba",
  member_tx_card_session:
    "93f377292499492c31d0a3355ccddf113c23ec63505a81fe288f9441c541a759",
  sale_card_session:
    "82f5e02b86c4b5878b1a67e295513b553479c94045e6df033974d9aaba0389f2",
};

const schemaUrl = new URL("./migrations/001_shop.sql", import.meta.url);
export const POSTGRES_SCHEMA_VERSION = "001";
type Column = {
  name: string;
  type: string;
  nullable: boolean;
  identity: boolean;
};
type Table = { name: string; columns: Column[] };
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => {
  if (value.includes("\0"))
    throw new Error("PostgreSQL text cannot contain NUL");
  return `'${value.replaceAll("'", "''")}'`;
};

/** Reads only the checked-in target schema, never DDL from an uploaded database. */
export function postgresSchema() {
  const sql = readFileSync(schemaUrl, "utf8");
  const afterLoadSql = readFileSync(
    new URL("./migrations/002_card_session_triggers.sql", import.meta.url),
    "utf8"
  );
  const tables: Table[] = [];
  for (const match of Array.from(
    sql.matchAll(/CREATE TABLE shop\."([a-z_]+)" \(\n([\s\S]*?)\n\);/g)
  )) {
    const columns: Column[] = [];
    for (const line of match[2].split("\n")) {
      const column =
        /^  "([a-z_]+)" (bigint|boolean|text|timestamptz|date|numeric\(\d+,\d+\))(?=\s|,|$)(.*)$/.exec(
          line
        );
      if (column)
        columns.push({
          name: column[1],
          type: column[2],
          nullable: !/NOT NULL|PRIMARY KEY/.test(column[3]),
          identity: column[3].includes("IDENTITY"),
        });
      else if (!/^  (CHECK|PRIMARY KEY|UNIQUE) /.test(line))
        throw new Error("Unsupported checked-in PostgreSQL column definition");
    }
    tables.push({ name: match[1], columns });
  }
  if (tables.length !== 25 || tables.some(table => !table.columns.length))
    throw new Error("PostgreSQL schema manifest is incomplete");
  return {
    sql,
    afterLoadSql,
    tables,
    sha256: createHash("sha256").update(sql).update(afterLoadSql).digest("hex"),
  };
}

function calendarDate(text: string) {
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    year < 1 ||
    year > 9999 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error("Invalid calendar date");
}

/** Preserves fractional seconds and explicit offsets. Unzoned Shop values are Bangkok wall time. */
export function postgresTimestamp(value: string) {
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      value
    );
  if (!match) throw new Error("Invalid timestamp format");
  calendarDate(match[1]);
  if (
    Number(match[2] ?? 0) > 23 ||
    Number(match[3] ?? 0) > 59 ||
    Number(match[4] ?? 0) > 59
  )
    throw new Error("Invalid timestamp time");
  const zone = match[6] ?? "+07:00";
  if (
    zone !== "Z" &&
    (Number(zone.slice(1, 3)) > 14 ||
      Number(zone.slice(4)) > 59 ||
      (zone.slice(1, 3) === "14" && zone.slice(4) !== "00"))
  )
    throw new Error("Invalid timestamp offset");
  return `${match[1]}T${match[2] ?? "00"}:${match[3] ?? "00"}:${match[4] ?? "00"}${match[5] ?? ""}${zone}`;
}

/** Expands the exact decimal representation delivered by SQLite; never silently rounds money. */
export function postgresDecimal(
  value: number | bigint,
  precision: number,
  scale: number
) {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Non-finite numeric value");
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new Error("Invalid numeric value");
  const digits = match[2] + (match[3] ?? "");
  const point = match[2].length + Number(match[4] ?? 0);
  let whole = (
    point <= 0 ? "0" : digits.slice(0, point).padEnd(point, "0")
  ).replace(/^0+(?=\d)/, "");
  const fraction = (
    point <= 0 ? "0".repeat(-point) + digits : digits.slice(point)
  ).replace(/0+$/, "");
  if (!whole) whole = "0";
  if (
    fraction.length > scale ||
    whole.replace(/^0+/, "").length > precision - scale
  )
    throw new Error("Numeric value would lose precision in PostgreSQL");
  return `${match[1]}${whole}${fraction ? "." + fraction : ""}`;
}

function cell(value: unknown, column: Column) {
  if (value === null) {
    if (!column.nullable) throw new Error("NULL in required column");
    return "NULL";
  }
  if (column.type === "boolean") {
    if (value !== BigInt(0) && value !== BigInt(1))
      throw new Error("Boolean must be 0 or 1");
    return value === BigInt(1) ? "true" : "false";
  }
  if (column.type === "bigint") {
    if (
      typeof value !== "bigint" ||
      value < BigInt("-9223372036854775808") ||
      value > BigInt("9223372036854775807")
    )
      throw new Error("Integer outside PostgreSQL bigint range");
    return value.toString();
  }
  const numeric = /^numeric\((\d+),(\d+)\)$/.exec(column.type);
  if (numeric) {
    if (typeof value !== "number" && typeof value !== "bigint")
      throw new Error("Numeric value has a non-numeric SQLite storage class");
    return postgresDecimal(value, Number(numeric[1]), Number(numeric[2]));
  }
  if (typeof value !== "string")
    throw new Error("Text value has a non-text SQLite storage class");
  if (column.type === "timestamptz") return literal(postgresTimestamp(value));
  if (column.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new Error("Invalid expiry date format");
    calendarDate(value);
  }
  return literal(value);
}

/** Offline rehearsal exporter. Does not connect to PostgreSQL or modify/upgrade the source.
 * Requires a verified, quiescent snapshot, not a live SQLite database/WAL pair.
 * The private output contains personal data, password hashes and session IDs.
 */
export function exportPostgresSnapshot(sourcePath: string, outputPath: string) {
  const source = resolve(sourcePath),
    output = resolve(outputPath);
  if (source === output) throw new Error("Output cannot replace the source");
  if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink())
    throw new Error("Source must be a regular snapshot file");
  if (existsSync(source + "-wal") && lstatSync(source + "-wal").size > 0)
    throw new Error("Use a verified SQLite snapshot without a live WAL");
  if (existsSync(output))
    throw new Error("Output already exists; refusing to overwrite");
  if (!lstatSync(dirname(output)).isDirectory())
    throw new Error("Output directory must already exist");
  const sourceSha256 = fileSha256(source);
  const schema = postgresSchema();
  const db = new DatabaseSync(source, { readOnly: true });
  let fd: number | undefined;
  let temporaryCreated = false;
  const temporary = output + `.partial-${process.pid}-${Date.now()}`;
  try {
    db.exec("BEGIN");
    const integrity = db.prepare("PRAGMA quick_check").all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok")
      throw new Error("SQLite integrity check failed");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("SQLite foreign keys are invalid");
    const objects = db
      .prepare(
        "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','view','trigger')"
      )
      .all() as { type: string; name: string; sql: string }[];
    const sourceTables = objects.filter(object => object.type === "table");
    const sourceTriggers = objects.filter(object => object.type === "trigger");
    if (
      objects.some(object => object.type === "view") ||
      sourceTables.length !== schema.tables.length ||
      sourceTables.some(
        object => !schema.tables.some(table => table.name === object.name)
      ) ||
      sourceTriggers.length !== Object.keys(canonicalTriggers).length ||
      sourceTriggers.some(
        object =>
          canonicalTriggers[object.name] !==
          createHash("sha256").update(object.sql).digest("hex")
      )
    )
      throw new Error(
        "Unsupported source tables, views or triggers; no data exported"
      );
    for (const table of schema.tables) {
      const columns = db
        .prepare(`PRAGMA table_info(${identifier(table.name)})`)
        .all()
        .map(column => column.name);
      if (
        columns.length !== table.columns.length ||
        columns.some((column, index) => column !== table.columns[index].name)
      )
        throw new Error(
          `Source schema differs: ${table.name}; upgrade a separate snapshot first`
        );
    }
    for (const table of ["sales", "member_transactions"]) {
      if (
        db
          .prepare(
            `SELECT client_request_id FROM ${identifier(table)} WHERE client_request_id IS NOT NULL GROUP BY client_request_id HAVING COUNT(*) > 1 LIMIT 1`
          )
          .get()
      )
        throw new Error(`Duplicate request IDs in ${table}; no data exported`);
    }
    fd = openSync(temporary, "wx", 0o600);
    temporaryCreated = true;
    const write = (sql: string) => {
      const buffer = Buffer.from(sql, "utf8");
      let offset = 0;
      while (offset < buffer.length)
        offset += writeSync(fd!, buffer, offset, buffer.length - offset);
    };
    write(
      `-- Shop migration REHEARSAL ONLY. Contains private data; do not commit or share.\n-- Import using psql -X -v ON_ERROR_STOP=1 -f <this-file> into a dedicated empty test database.\nBEGIN;\nDO $shop_target$ BEGIN IF pg_catalog.left(pg_catalog.current_database(), 18) <> 'shop_pg_rehearsal_' THEN RAISE EXCEPTION 'Use a dedicated shop_pg_rehearsal_ database'; END IF; END; $shop_target$;\n${schema.sql}\nSET CONSTRAINTS ALL DEFERRED;\n`
    );
    const counts: Record<string, string> = {};
    for (const table of schema.tables) {
      let count = BigInt(0);
      const totals = new Map<string, { scale: number; sum: bigint }>();
      for (const column of table.columns) {
        const numeric = /^numeric\(\d+,(\d+)\)$/.exec(column.type);
        if (column.type === "bigint" || numeric)
          totals.set(column.name, {
            scale: numeric ? Number(numeric[1]) : 0,
            sum: BigInt(0),
          });
      }
      const statement = db.prepare(`SELECT * FROM ${identifier(table.name)}`);
      statement.setReadBigInts(true);
      const iterator = statement.iterate();
      for (let next = iterator.next(); !next.done; next = iterator.next()) {
        const row = next.value;
        const values = table.columns.map(column => {
          try {
            return cell(row[column.name], column);
          } catch (error) {
            throw new Error(
              `Cannot export ${table.name}.${column.name} at row ${count + BigInt(1)}: ${error instanceof Error ? error.message : "invalid value"}`
            );
          }
        });
        for (let index = 0; index < table.columns.length; index++) {
          const total = totals.get(table.columns[index].name);
          if (total && values[index] !== "NULL") {
            const negative = values[index].startsWith("-");
            const [whole, fraction = ""] = values[index]
              .replace(/^-/, "")
              .split(".");
            total.sum +=
              BigInt(whole + fraction.padEnd(total.scale, "0")) *
              BigInt(negative ? -1 : 1);
          }
        }
        write(
          `INSERT INTO shop.${identifier(table.name)} (${table.columns.map(column => identifier(column.name)).join(",")}) VALUES (${values.join(",")});\n`
        );
        count++;
      }
      counts[table.name] = String(count);
      // INSERT statements fail rather than ignore duplicates. Check the complete count again on target.
      write(
        `DO $shop_check$ BEGIN IF (SELECT count(*) FROM shop.${identifier(table.name)}) <> ${count} THEN RAISE EXCEPTION 'Migration count mismatch: ${table.name}'; END IF; END; $shop_check$;\n`
      );
      for (const [name, total] of Array.from(totals.entries())) {
        const magnitude = (total.sum < BigInt(0) ? -total.sum : total.sum)
          .toString()
          .padStart(total.scale + 1, "0");
        const value =
          (total.sum < BigInt(0) ? "-" : "") +
          (total.scale
            ? magnitude.slice(0, -total.scale) +
              "." +
              magnitude.slice(-total.scale)
            : magnitude);
        write(
          `DO $shop_check$ BEGIN IF (SELECT COALESCE(SUM(${identifier(name)}), 0) FROM shop.${identifier(table.name)}) <> ${value} THEN RAISE EXCEPTION 'Migration total mismatch: ${table.name}.${name}'; END IF; END; $shop_check$;\n`
        );
      }
      for (const column of table.columns.filter(column => column.identity)) {
        write(
          `SELECT setval(pg_get_serial_sequence('shop.${identifier(table.name)}', ${literal(column.name)}), GREATEST(COALESCE((SELECT MAX(${identifier(column.name)}) FROM shop.${identifier(table.name)}), 0), 1), EXISTS (SELECT 1 FROM shop.${identifier(table.name)} WHERE ${identifier(column.name)} >= 1));\n`
        );
      }
    }
    write(
      `${schema.afterLoadSql}\nSET CONSTRAINTS ALL IMMEDIATE;\nINSERT INTO shop.schema_migrations (version, source_sha256, schema_sha256) VALUES (${literal(POSTGRES_SCHEMA_VERSION)}, ${literal(sourceSha256)}, ${literal(schema.sha256)});\nCOMMIT;\n`
    );
    if (
      fileSha256(source) !== sourceSha256 ||
      (existsSync(source + "-wal") && lstatSync(source + "-wal").size > 0)
    )
      throw new Error("Source changed during export; use a quiescent snapshot");
    closeSync(fd);
    fd = undefined;
    // Hard-link publication is exclusive on Windows NTFS and Linux; never rename over another file.
    linkSync(temporary, output);
    return {
      formatVersion: 1,
      purpose: "postgresql-migration-rehearsal",
      postgresAppReady: false,
      sourceSha256,
      schemaSha256: schema.sha256,
      tables: counts,
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (temporaryCreated && existsSync(temporary)) unlinkSync(temporary);
    try {
      db.exec("ROLLBACK");
    } finally {
      db.close();
    }
  }
}
