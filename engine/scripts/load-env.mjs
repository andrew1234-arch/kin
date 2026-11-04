#!/usr/bin/env node
// Prints `export KEY='value'` lines for dotenv files, for the run scripts to eval (see run-env.sh).
// Parsing is node:util parseEnv (also implemented by Bun), so quotes, inline comments, `&`, `$` and `#`
// behave exactly as they do when Node or Bun load the same file. Nothing is ever run as shell code.
//
// Precedence: a non-blank value already in the environment wins; otherwise the first file that sets a
// non-blank value wins. Blank values (KEY=) mean "unset" and never hide a value set later or elsewhere.
// Within one file the last assignment wins, as in Node and Bun. Missing files are skipped.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const nonBlank = (v) => typeof v === "string" && v.trim() !== "";
const chosen = new Map();
for (const file of process.argv.slice(2)) {
  if (!existsSync(file)) continue;
  const parsed = parseEnv(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (chosen.has(key) || !nonBlank(value) || nonBlank(process.env[key])) continue;
    chosen.set(key, value);
  }
}
const quote = (v) => `'${v.replace(/'/g, `'\\''`)}'`;
for (const [key, value] of chosen) process.stdout.write(`export ${key}=${quote(value)}\n`);
