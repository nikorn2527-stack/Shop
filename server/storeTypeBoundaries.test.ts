import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : /\.tsx?$/.test(path)
        ? [path]
        : [];
  });
}

function imports(path: string): string[] {
  const ast = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const result: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      result.push(node.argument.literal.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}

describe("business contract dependency boundaries", () => {
  it("keeps business services and domain helpers independent of database implementations", () => {
    const roots = ["./services/", "./domain/"].map((directory) =>
      fileURLToPath(new URL(directory, import.meta.url)),
    );
    const violations = roots
      .flatMap((root) => files(root))
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .flatMap((path) =>
        imports(path)
          .filter((name) =>
            /(?:^|\/)(sqlite[^/]*|welfareStore)(?:\.|$)|^node:sqlite$|^(pg|mysql2|drizzle-orm)(\/|$)/.test(
              name,
            ),
          )
          .map((name) => `${path}: ${name}`),
      );
    expect(violations).toEqual([]);
  });

  it("keeps frontend imports independent of the SQLite implementation", () => {
    const root = fileURLToPath(new URL("../client/src", import.meta.url));
    const violations = files(root).flatMap((path) =>
      imports(path)
        .filter((name) => /(?:^|\/)sqliteStore(?:\.|$)/.test(name))
        .map((name) => `${path}: ${name}`),
    );
    expect(violations).toEqual([]);
  });

  it("keeps shared business contracts independent of server and database runtimes", () => {
    const root = fileURLToPath(
      new URL("../shared/storeTypes/", import.meta.url),
    );
    const violations = files(root)
      .filter((path) => !path.endsWith(".test.ts"))
      .flatMap((path) =>
        imports(path)
          .filter((name) => !name.startsWith("./"))
          .map((name) => `${path}: ${name}`),
      );
    expect(violations).toEqual([]);
  });
});
