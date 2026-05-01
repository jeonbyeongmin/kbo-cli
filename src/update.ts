import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import pkg from "../package.json" with { type: "json" };

const REGISTRY_URL = "https://registry.npmjs.org/kbo-cli/latest";
const CACHE_DIR = path.join(os.homedir(), ".cache", "kbo-cli");
const CACHE_FILE = path.join(CACHE_DIR, "update-check.json");
const CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

interface CacheEntry {
  lastCheck: number;
  latest: string;
}

export const CURRENT_VERSION: string = (pkg as { version: string }).version;

function readCache(): CacheEntry | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entry));
  } catch {}
}

function compareVersion(a: string, b: string): number {
  const am = a.split("-")[0] ?? "0";
  const bm = b.split("-")[0] ?? "0";
  const pa = am.split(".").map((n) => Number(n) || 0);
  const pb = bm.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function detectInstallCommand(): string {
  const exec = process.argv[1] ?? "";
  let real = exec;
  try {
    real = fs.realpathSync(exec);
  } catch {}
  const hint = `${exec}\n${real}`.replaceAll("\\", "/");
  if (hint.includes("/.bun/") || hint.includes("/bun/install/")) return "bun add -g kbo-cli";
  if (hint.includes("/pnpm/") || hint.includes("/.pnpm/")) return "pnpm add -g kbo-cli";
  if (hint.includes("/.yarn/") || hint.includes("/yarn/")) return "yarn global add kbo-cli";
  return "npm i -g kbo-cli";
}

export function maybeTriggerBackgroundCheck(): void {
  if (process.env.KBO_NO_UPDATE_CHECK === "1") return;
  const cache = readCache();
  if (cache && Date.now() - cache.lastCheck < CHECK_TTL_MS) return;

  try {
    const entry = process.argv[1];
    if (!entry) return;
    const child = spawn(process.execPath, [entry, "__update-check"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {}
}

export async function runBackgroundCheck(): Promise<void> {
  const latest = await fetchLatestVersion();
  if (latest) writeCache({ lastCheck: Date.now(), latest });
}

export function getUpdateBanner(): string | null {
  if (!process.stdout.isTTY) return null;
  const cache = readCache();
  if (!cache) return null;
  if (compareVersion(cache.latest, CURRENT_VERSION) <= 0) return null;

  const cmd = detectInstallCommand();
  return [
    pc.yellow("┌─ 새 버전이 있어요 ──────────────────"),
    pc.yellow(`│ ${pc.dim(`v${CURRENT_VERSION}`)} → ${pc.green(pc.bold(`v${cache.latest}`))}`),
    pc.yellow(`│ ${pc.cyan("kbo update")}  또는  ${pc.cyan(cmd)}`),
    pc.yellow("└─────────────────────────────────────"),
  ].join("\n");
}

export async function runUpdate(): Promise<void> {
  console.log(pc.dim("최신 버전 확인 중..."));
  const latest = await fetchLatestVersion();
  if (!latest) {
    console.error(pc.red("최신 버전을 가져오지 못했습니다. 네트워크를 확인하세요."));
    process.exit(1);
  }
  if (compareVersion(latest, CURRENT_VERSION) <= 0) {
    console.log(pc.green(`이미 최신 버전입니다 (v${CURRENT_VERSION}).`));
    return;
  }

  const cmd = detectInstallCommand();
  console.log(`${pc.bold(`v${CURRENT_VERSION}`)} → ${pc.green(pc.bold(`v${latest}`))}`);
  console.log(pc.dim(`$ ${cmd}\n`));

  const parts = cmd.split(" ");
  const r = spawnSync(parts[0]!, parts.slice(1), { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(pc.red("\n업데이트 명령이 실패했습니다."));
    process.exit(r.status ?? 1);
  }
  try {
    fs.unlinkSync(CACHE_FILE);
  } catch {}
  console.log(pc.green(`\n✓ v${latest} 업데이트 완료`));
}
