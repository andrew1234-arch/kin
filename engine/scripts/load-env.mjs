#!/usr/bin/env node
// Prints `export KEY='value'` lines for dotenv files, for `eval "$(node load-env.mjs a.env b.env)"`.
// Parses dotenv syntax itself (the files are never run as shell code), so `&`, `;`, spaces and `$` in
// values are safe. Precedence: variables already set in the environment win, then the first file that
// sets a key. Blank values are treated as unset and skipped. Missing files are ignored.
import { existsSync, readFileSync } from "node:fs";

const seen = new Set();
const quote = (v) => `'${v.replace(/'/g, `'\\''`)}'`;
for (const file of process.argv.slice(2)) {
  if (!existsSync(file)) continue;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) || (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
      const dq = val.startsWith('"');
      val = val.slice(1, -1);
      if (dq) val = val.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else {
      val = val.replace(/\s+#.*$/, "").trim(); // inline comment on an unquoted value
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const current = process.env[key];
    if (current !== undefined && current.trim() !== "") continue; // the caller's environment wins
    if (val.trim() === "") continue; // blank means unset
    process.stdout.write(`export ${key}=${quote(val)}\n`);
  }
}
