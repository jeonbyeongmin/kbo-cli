import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface CacheEntry<T> {
  savedAt: number;
  payload: T;
}

function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".cache");
  return path.join(base, "kbo-cli");
}

function cachePath(key: string): string {
  return path.join(cacheDir(), `status-${key}.json`);
}

export function readCache<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = fs.readFileSync(cachePath(key), "utf8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (typeof entry.savedAt !== "number") return null;
    if (Date.now() - entry.savedAt > ttlMs) return null;
    return entry.payload;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, payload: T): void {
  try {
    const dir = cacheDir();
    fs.mkdirSync(dir, { recursive: true });
    // 같은 파일시스템에서 rename 은 POSIX atomic — statusline 동시 호출 시 부분 쓰기 방지.
    const tmp = path.join(dir, `status-${key}.json.tmp.${process.pid}`);
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), payload }));
    fs.renameSync(tmp, cachePath(key));
  } catch {}
}
