// Structural guard tests G1, G2 (GigHold A1.1, SPEC_ADDENDUM "A1").
// A text scan, not a parser: no database, no network, no new dependency.
// G1 fails when app code so much as tries to update or delete `bookings`
// directly (SPEC section 8, CLAUDE.md hard rule 8). Test D7 remains the
// enforcement; this is the early warning.
//
// This file holds forbidden text on purpose (the G2 samples). That is safe:
// G1 never scans tests/.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------

// Pattern 1 starts here: .from('bookings') in single, double or backtick
// quotes. `\1` means "the same quote character that opened the name".
const FROM_BOOKINGS = /\.from\(\s*(['"`])bookings\1\s*\)/g;

// A write method in the chain: .update(  .delete(  .upsert(
// The `y` (sticky) flag makes the regex match only at the exact position
// given in lastIndex, instead of searching forward from it.
const WRITE_METHOD = /\.\s*(?:update|delete|upsert)\s*\(/y;

// Pattern 2: SQL text. `i` = any letter case; `\s+` = any whitespace,
// including line breaks, between the words. The schema prefix and double
// quotes around the names are optional. The trailing `\b` stops a longer
// name such as bookings_archive from matching (`_` counts as a word
// character, as it does in a Postgres or T-SQL identifier).
const SQL_WRITES = [
  /\bupdate\s+(?:"?public"?\s*\.\s*)?"?bookings\b/gi,
  /\bdelete\s+from\s+(?:"?public"?\s*\.\s*)?"?bookings\b/gi,
];

// Walks forward from just after `.from('bookings')` to the end of that
// statement and returns the position of the first write method that belongs
// to the chain itself, or -1 if there is none.
//
// "Belongs to the chain" means bracket depth 0: text inside the arguments of
// another call, for example .select("...") or a .then(() => ...) callback,
// is at depth 1 or more and is not part of this chain. Line breaks are
// ordinary characters here, so a chain split over several lines is followed.
//
// The statement ends at a `;` or `,` at depth 0, or at a closing bracket that
// was opened before the chain began. Comments and string contents are
// skipped, so a `;` or a bracket inside them cannot end the walk early.
function findChainWrite(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (c === "/" && next === "/") {
      // Line comment: jump to the end of the line.
      const end = text.indexOf("\n", i);
      if (end === -1) return -1;
      i = end;
      continue;
    }
    if (c === "/" && next === "*") {
      // Block comment: jump past the closing */.
      const end = text.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      // String: jump past the closing quote. A backslash escapes the next
      // character. Only backtick strings may run over a line break.
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\n" && c !== "`") break;
        if (text[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }

    if (c === "(" || c === "[" || c === "{") {
      depth += 1;
    } else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth < 0) return -1;
    } else if (depth === 0) {
      if (c === ";" || c === ",") return -1;
      if (c === ".") {
        WRITE_METHOD.lastIndex = i;
        if (WRITE_METHOD.test(text)) return i;
      }
    }
    i += 1;
  }
  return -1;
}

// Takes the text of one file and returns the 1-based line numbers of the
// violations, in ascending order. For a chain, the line reported is the one
// holding the write method; for SQL, the line where the statement starts.
function findBookingsWrites(text: string): number[] {
  const lines = new Set<number>();
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;

  for (const match of text.matchAll(FROM_BOOKINGS)) {
    const hit = findChainWrite(text, match.index + match[0].length);
    if (hit !== -1) lines.add(lineOf(hit));
  }
  for (const pattern of SQL_WRITES) {
    for (const match of text.matchAll(pattern)) {
      lines.add(lineOf(match.index));
    }
  }
  return [...lines].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// G1
// ---------------------------------------------------------------------------

// `npm test` runs Vitest from the project root, so the working directory is
// the root.
const PROJECT_ROOT = process.cwd();

// Every .ts and .tsx file under app/ and lib/, plus proxy.ts, as paths
// relative to the project root with forward slashes.
function filesToScan(): string[] {
  const found: string[] = [];
  for (const dir of ["app", "lib"]) {
    // "recursive <boolean> If true, reads the contents of a directory
    // recursively. In recursive mode, it will list all files, sub files, and
    // directories. Default: false." (option added in v20.1.0 / v18.17.0)
    // Each entry comes back as a path relative to `dir`, e.g.
    // "admin\page.tsx" on Windows.
    // Source: https://nodejs.org/docs/latest-v24.x/api/fs.html#fsreaddirsyncpath-options
    const entries = readdirSync(path.join(PROJECT_ROOT, dir), {
      recursive: true,
    });
    for (const entry of entries) {
      const relative = path.join(dir, entry).split(path.sep).join("/");
      if (!/\.tsx?$/.test(relative)) continue;
      // Only app/ and lib/ are walked, so supabase/migrations/ and tests/
      // are never reached. These checks keep that true if a folder with one
      // of those names ever appears inside app/ or lib/.
      if (/(^|\/)(node_modules|tests)\//.test(relative)) continue;
      if (relative.includes("supabase/migrations/")) continue;
      found.push(relative);
    }
  }
  found.push("proxy.ts");
  return found.sort();
}

describe("G1: no direct writes to bookings", () => {
  test("no .ts or .tsx file under app/ or lib/, nor proxy.ts, updates or deletes bookings", () => {
    const files = filesToScan();
    // An empty list would pass quietly; make sure the walk found the app.
    expect(files).toContain("app/actions.ts");
    expect(files).toContain("lib/supabase.ts");

    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(path.join(PROJECT_ROOT, file), "utf8");
      const sourceLines = text.split("\n");
      for (const line of findBookingsWrites(text)) {
        violations.push(`${file}:${line}: ${sourceLines[line - 1].trim()}`);
      }
    }

    // The second argument is the message Vitest shows if this fails.
    expect(
      violations,
      `Direct write to bookings found. Status changes go through begin_capture, ` +
        `begin_cancel and apply_stripe_event only (SPEC section 8):\n` +
        violations.join("\n"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// G2
// ---------------------------------------------------------------------------

describe("G2: the guard can fail", () => {
  test("flags one sample of each forbidden pattern and passes the two allowed samples", () => {
    // [description, sample text, expected line numbers]
    const forbidden: [string, string, number[]][] = [
      [
        "chain, single quotes, .update(",
        `await supabase.from('bookings').update({ status: "captured" }).eq("id", id);`,
        [1],
      ],
      [
        "chain over several lines, double quotes, .delete(",
        [
          `const { error } = await supabase`,
          `  .from("bookings")`,
          `  // a comment; with a semicolon, inside the chain`,
          `  .delete()`,
          `  .eq("id", id);`,
        ].join("\n"),
        [4],
      ],
      [
        "chain, backtick quotes, .upsert(, after a filter-style call",
        "await supabase.from(`bookings`).select('id; status').upsert(row);",
        [1],
      ],
      ["SQL: update bookings", `await client.query("update bookings set status = $1");`, [1]],
      [
        "SQL: update public.bookings, mixed case, line break between words",
        "const sql = `\n  UPDATE\n    Public.Bookings\n  SET status = 'captured'`;",
        [2],
      ],
      ["SQL: delete from bookings", `await client.query("DELETE   FROM\tbookings");`, [1]],
      [
        "SQL: delete from public.bookings",
        `await client.query("Delete From public.bookings where id = $1");`,
        [1],
      ],
    ];
    for (const [description, sample, expectedLines] of forbidden) {
      expect(findBookingsWrites(sample), description).toEqual(expectedLines);
    }

    const allowed: [string, string][] = [
      [
        "an insert into bookings",
        [
          `const { data, error } = await supabase`,
          `  .from("bookings")`,
          `  .insert({ customer_name: name })`,
          `  .select("id")`,
          `  .single();`,
          `await client.query("insert into bookings (customer_name) values ($1)");`,
        ].join("\n"),
      ],
      [
        "an update of a different table",
        [
          `await supabase.from("stripe_events").update({ outcome: "applied" }).eq("id", id);`,
          `await client.query("update public.stripe_events set outcome = $1");`,
        ].join("\n"),
      ],
    ];
    for (const [description, sample] of allowed) {
      expect(findBookingsWrites(sample), description).toEqual([]);
    }
  });
});
