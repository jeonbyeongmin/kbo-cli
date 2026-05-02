import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// render.ts 의 TEAM_HEX 키와 순서를 동기화한다 — KBO 팀 변경 시 양쪽 갱신.
export const KNOWN_TEAMS: readonly string[] = [
  "LG",
  "두산",
  "KIA",
  "KT",
  "삼성",
  "한화",
  "SSG",
  "롯데",
  "NC",
  "키움",
] as const;

export interface KboConfig {
  favoriteTeam?: string;
}

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "kbo-cli");
}

function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): KboConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  const cfg: KboConfig = {};
  const ft = (raw as { favoriteTeam?: unknown }).favoriteTeam;
  if (typeof ft === "string" && KNOWN_TEAMS.includes(ft)) cfg.favoriteTeam = ft;
  return cfg;
}

export function saveConfig(cfg: KboConfig): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  // 같은 파일시스템에서 rename 은 POSIX atomic — 동시 watch/config 호출 시 부분 쓰기 방지.
  const tmp = path.join(dir, `config.json.tmp.${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, configPath());
}
