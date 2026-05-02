import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import { TEAM_NAMES, colorTeam, frame, padEnd } from "./render.ts";

export interface KboConfig {
  favoriteTeam?: string;
  interval?: number;
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
  if (typeof ft === "string" && TEAM_NAMES.includes(ft)) cfg.favoriteTeam = ft;
  const intv = (raw as { interval?: unknown }).interval;
  if (typeof intv === "number" && Number.isInteger(intv) && intv >= 1 && intv <= 3600) {
    cfg.interval = intv;
  }
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

const ENTER_ALT = "\x1b[?1049h";
const EXIT_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const HOME = "\x1b[H";
const CLEAR_AFTER = "\x1b[J";
const CLEAR_LINE = "\x1b[K";
const FRAME_WIDTH = 48;

interface ConfigItem {
  key: keyof KboConfig;
  label: string;
  // null = "(없음)" — unset 항목.
  values: (string | number | null)[];
}

function buildItems(): ConfigItem[] {
  return [
    {
      key: "favoriteTeam",
      label: "즐겨찾기 팀",
      values: [...TEAM_NAMES, null],
    },
    {
      key: "interval",
      label: "폴링 간격",
      values: [1, 2, 3, 5, 10, 15, 30, null],
    },
  ];
}

function valueIndex(item: ConfigItem, current: string | number | null | undefined): number {
  const idx = item.values.indexOf(current ?? null);
  return idx >= 0 ? idx : item.values.length - 1;
}

function valueLabel(value: string | number | null): string {
  if (value == null) return pc.dim("(없음)");
  if (typeof value === "number") return pc.cyan(`${value}초`);
  return colorTeam(value);
}

function summary(cfg: KboConfig): string {
  const team = cfg.favoriteTeam ? colorTeam(cfg.favoriteTeam) : pc.dim("(없음)");
  return `즐겨찾기 팀: ${team}`;
}

function renderConfig(items: ConfigItem[], indices: number[], cursor: number): string {
  const body: string[] = [];
  items.forEach((item, i) => {
    const active = i === cursor;
    const prefix = active ? pc.cyan("▶ ") : "  ";
    const labelCol = active ? pc.bold(item.label) : pc.dim(item.label);
    const value = item.values[indices[i] ?? 0] ?? null;
    const valCell = active
      ? `${pc.cyan("◀")} ${valueLabel(value)} ${pc.cyan("▶")}`
      : valueLabel(value);
    body.push(`${prefix}${padEnd(labelCol, 14)}  ${valCell}`);
  });
  body.push("");
  body.push(pc.dim("값은 ←/→ 로 변경, s 또는 Enter 로 저장합니다."));
  return frame("kbo config", body, "↑/↓: 항목  ←/→: 값  s/Enter: 저장  q: 종료", FRAME_WIDTH).join(
    "\n"
  );
}

export async function cmdConfig(): Promise<void> {
  const items = buildItems();
  const cfg = loadConfig();
  const indices: number[] = items.map((it) =>
    valueIndex(it, cfg[it.key] as string | number | undefined)
  );

  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    console.log(summary(cfg));
    return;
  }

  let cursor = 0;
  let stopped = false;

  const cleanup = () => {
    if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(SHOW_CURSOR + EXIT_ALT);
  };

  const exitClean = (code = 0) => {
    if (stopped) return;
    stopped = true;
    cleanup();
    process.exit(code);
  };

  process.on("SIGINT", () => exitClean(0));
  process.on("SIGTERM", () => exitClean(0));
  process.on("uncaughtException", (err) => {
    cleanup();
    console.error("\n에러 발생:", err);
    process.exit(1);
  });

  process.stdout.write(ENTER_ALT + HIDE_CURSOR);

  const draw = () => {
    if (stopped) return;
    const out = `${renderConfig(items, indices, cursor)}\n`;
    process.stdout.write(HOME);
    for (const line of out.split("\n")) {
      process.stdout.write(`${CLEAR_LINE + line}\n`);
    }
    process.stdout.write(CLEAR_AFTER);
  };

  const save = () => {
    const next: KboConfig = {};
    items.forEach((item, i) => {
      const value = item.values[indices[i] ?? 0];
      if (value == null) return;
      if (item.key === "favoriteTeam" && typeof value === "string") next.favoriteTeam = value;
    });
    try {
      saveConfig(next);
    } catch (e) {
      cleanup();
      console.error(pc.red(`저장 실패: ${(e as Error).message}`));
      process.exit(1);
    }
    exitClean(0);
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (data: string) => {
    if (data === "q" || data === "Q" || data === "\x03") {
      exitClean(0);
      return;
    }
    if (data === "s" || data === "S" || data === "\r" || data === "\n") {
      save();
      return;
    }
    if (data === "\x1b[A") {
      const next = (cursor - 1 + items.length) % items.length;
      if (next === cursor) return;
      cursor = next;
      draw();
      return;
    }
    if (data === "\x1b[B") {
      const next = (cursor + 1) % items.length;
      if (next === cursor) return;
      cursor = next;
      draw();
      return;
    }
    if (data === "\x1b[D") {
      const len = items[cursor]!.values.length;
      indices[cursor] = ((indices[cursor] ?? 0) - 1 + len) % len;
      draw();
      return;
    }
    if (data === "\x1b[C") {
      const len = items[cursor]!.values.length;
      indices[cursor] = ((indices[cursor] ?? 0) + 1) % len;
      draw();
      return;
    }
  });

  draw();
  await new Promise<void>(() => {});
}
