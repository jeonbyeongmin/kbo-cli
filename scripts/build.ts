import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const out = "dist/kbo.js";

const r = spawnSync(
  "bun",
  ["build", "--target=node", "--minify", "./src/index.ts", "--outfile", out],
  { stdio: "inherit" }
);
if (r.status !== 0) process.exit(r.status ?? 1);

const code = readFileSync(out, "utf8");
const SHEBANG = "#!/usr/bin/env node\n";
const final = code.startsWith("#!") ? code : SHEBANG + code;
writeFileSync(out, final);
chmodSync(out, 0o755);

console.log(`✓ wrote ${out} (${final.length} bytes)`);
