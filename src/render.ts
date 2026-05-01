import pc from "picocolors";
import type { BatterStats, NormalizedGame, PitcherStats, ScheduleGame } from "./types.ts";

const TEAM_HEX: Record<string, string> = {
  LG: "#C30452",
  두산: "#1A1748",
  KIA: "#EA0029",
  KT: "#000000",
  삼성: "#074CA1",
  한화: "#FC4E00",
  SSG: "#CE0E2D",
  롯데: "#041E42",
  NC: "#315288",
  키움: "#570514",
};

// fg 는 BT.601 perceived brightness 로 흑/백 자동 선택해 어떤 팀 hex 에서도 가독성 확보.
function chip(hex: string): (s: string) => string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const fg = brightness > 128 ? "0;0;0" : "255;255;255";
  const open = `\x1b[48;2;${r};${g};${b}m\x1b[38;2;${fg}m`;
  const close = "\x1b[49m\x1b[39m";
  return (str) => (pc.isColorSupported ? `${open}${str}${close}` : str);
}

const TEAM_COLOR: Record<string, (s: string) => string> = Object.fromEntries(
  Object.entries(TEAM_HEX).map(([k, v]) => [k, chip(v)])
);

// 영문 2글자 팀명은 자간 1 을 넣어 한국어 2자 (visual 4) 와 시각적 폭을 가깝게 맞춘다.
const TEAM_DISPLAY: Record<string, string> = {
  KT: "K T",
  LG: "L G",
  NC: "N C",
};

export function colorTeam(name: string): string {
  const display = TEAM_DISPLAY[name] ?? name;
  const fn = TEAM_COLOR[name];
  return fn ? fn(pc.bold(display)) : pc.bold(display);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require \x1b
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function visualWidth(s: string): number {
  const stripped = s.replace(ANSI_RE, "");
  let w = 0;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0)!;
    // Wide chars: CJK, etc.
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3041 && cp <= 0x33ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

export function padEnd(s: string, width: number): string {
  const w = visualWidth(s);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
}

export function padStart(s: string, width: number): string {
  const w = visualWidth(s);
  if (w >= width) return s;
  return " ".repeat(width - w) + s;
}

const W = 56; // inner width of box

export function frame(
  title: string,
  body: string[],
  footer: string,
  innerWidth: number = W
): string[] {
  const top = `┌─ ${title} ${"─".repeat(Math.max(0, innerWidth - visualWidth(title) - 3))}┐`;
  const bot = `└${"─".repeat(innerWidth)}┘`;
  const lines = [top];
  for (const line of body) {
    lines.push(`│ ${padEnd(line, innerWidth - 2)} │`);
  }
  lines.push(`├${"─".repeat(innerWidth)}┤`);
  lines.push(`│ ${padEnd(footer, innerWidth - 2)} │`);
  lines.push(bot);
  return lines;
}

function diamondLines(bases: { first: boolean; second: boolean; third: boolean }): string[] {
  const r1 = bases.first;
  const r2 = bases.second;
  const r3 = bases.third;
  const filled = pc.yellow("◆");
  const empty = pc.dim("◇");
  // 2nd at top, 3rd left, 1st right
  return [
    `       ${r2 ? filled : empty}       `,
    "     ╱   ╲     ",
    `   ${r3 ? filled : empty}       ${r1 ? filled : empty}   `,
    "     ╲   ╱     ",
    "       ⌂       ",
  ];
}

function dots(filled: number, total: number, color: (s: string) => string): string {
  const out: string[] = [];
  for (let i = 0; i < total; i++) out.push(i < filled ? color("●") : pc.dim("○"));
  return out.join("");
}

function inningLabel(inning: number, topBottom: "top" | "bottom"): string {
  return `${inning}회${topBottom === "top" ? "초" : "말"}`;
}

function timeStr(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

const NAME_COL = 10;

export function truncName(name: string): string {
  if (visualWidth(name) <= NAME_COL) return name;
  let acc = "";
  for (const ch of name) {
    if (visualWidth(acc + ch) > NAME_COL - 1) break;
    acc += ch;
  }
  return `${acc}…`;
}

function renderBatterSection(b: BatterStats | null): string[] {
  const lines: string[] = [];
  lines.push(pc.dim("  ─ 타자 ─"));
  if (!b) {
    lines.push(`  ${pc.dim("?")}`);
    return lines;
  }
  const nameCell = padEnd(truncName(b.name || "?"), NAME_COL);
  const seasonPart = b.seasonAvg ? `시즌 AVG ${b.seasonAvg}` : pc.dim("시즌 기록 없음");
  lines.push(`  ${nameCell}  ${seasonPart}`);
  if (b.todayLine) {
    const tail = b.todayAvg ? `  ${pc.dim(`(AVG ${b.todayAvg})`)}` : "";
    lines.push(`  ${padEnd(pc.dim("오늘"), NAME_COL)}  ${b.todayLine}${tail}`);
  }
  if (b.vsPitcher) {
    lines.push(`  ${padEnd(pc.dim("vs투수"), NAME_COL)}  ${pc.dim(b.vsPitcher)}`);
  }
  return lines;
}

function renderPitcherSection(p: PitcherStats | null): string[] {
  const lines: string[] = [];
  lines.push(pc.dim("  ─ 투수 ─"));
  if (!p) {
    lines.push(`  ${pc.dim("?")}`);
    return lines;
  }
  const nameCell = padEnd(truncName(p.name || "?"), NAME_COL);
  const seasonPart = p.seasonEra ? `시즌 ERA ${p.seasonEra}` : pc.dim("시즌 기록 없음");
  lines.push(`  ${nameCell}  ${seasonPart}`);
  if (p.todayLine) {
    const tail = p.todayEra ? `  ${pc.dim(`(ERA ${p.todayEra})`)}` : "";
    lines.push(`  ${padEnd(pc.dim("오늘"), NAME_COL)}  ${p.todayLine}${tail}`);
  }
  return lines;
}

export function renderGame(game: NormalizedGame, opts: { staleSec?: number } = {}): string {
  const stale = opts.staleSec ?? 0;
  const headerStatus =
    game.status === "STARTED"
      ? `${inningLabel(game.inning, game.topBottom)} ${game.out}사`
      : game.status === "RESULT"
        ? "경기 종료"
        : game.status === "READY"
          ? "경기 전"
          : game.status;
  const staleTag = stale > 5 ? pc.yellow(` ⚠ stale ${stale}s`) : "";
  const title = `KBO LIVE · ${headerStatus}${staleTag}`;

  const body: string[] = [];

  body.push("");
  // Score block
  const awayLine = `  ${padEnd(colorTeam(game.awayTeamName), 8)}  ${pc.bold(
    String(game.awayScore).padStart(2)
  )}`;
  const homeLine = `  ${padEnd(colorTeam(game.homeTeamName), 8)}  ${pc.bold(
    String(game.homeScore).padStart(2)
  )}`;
  body.push(awayLine + (game.topBottom === "top" ? pc.cyan("  ◀ 공격") : ""));
  body.push(homeLine + (game.topBottom === "bottom" ? pc.cyan("  ◀ 공격") : ""));
  body.push("");

  // Diamond + count side by side
  const diamond = diamondLines(game.bases);
  const countBlock = [
    "",
    `  B  ${dots(game.ball, 3, pc.green)}`,
    `  S  ${dots(game.strike, 2, pc.yellow)}`,
    `  O  ${dots(game.out, 2, pc.red)}`,
    "",
  ];
  for (let i = 0; i < diamond.length; i++) {
    const left = diamond[i] ?? "";
    const right = countBlock[i] ?? "";
    body.push(`${left}    ${right}`);
  }
  body.push("");

  // Batter / Pitcher
  if (game.status === "STARTED") {
    for (const ln of renderBatterSection(game.batterStats)) body.push(ln);
    body.push("");
    for (const ln of renderPitcherSection(game.pitcherStats)) body.push(ln);
    body.push("");
  }

  // Inning line score
  if (game.inningLine.away.length > 0) {
    const innings = game.inningLine.away.length;
    const headerCells = Array.from({ length: innings }, (_, i) => String(i + 1).padStart(2)).join(
      " "
    );
    body.push(`  ${pc.dim(padEnd("회", 6))} ${pc.dim(headerCells)}`);
    const awayCells = game.inningLine.away.map((v) => v.padStart(2)).join(" ");
    const homeCells = game.inningLine.home.map((v) => v.padStart(2)).join(" ");
    body.push(`  ${padEnd(game.awayTeamName, 6)} ${awayCells}`);
    body.push(`  ${padEnd(game.homeTeamName, 6)} ${homeCells}`);
    body.push("");
  }

  // Recent plays
  if (game.recentPlays.length > 0) {
    body.push(pc.dim("  ─ 최근 플레이 ─"));
    for (const p of game.recentPlays.slice(0, 5)) {
      const trimmed = p.length > W - 6 ? `${p.slice(0, W - 8)}…` : p;
      body.push(`  • ${trimmed}`);
    }
  }

  const footer = `q:종료  r:새로고침  ←/→:경기전환  · ${timeStr(game.fetchedAt)}`;
  return frame(title, body, footer).join("\n");
}

export function renderScheduleList(games: ScheduleGame[], date: string): string {
  const lines: string[] = [];
  lines.push(pc.bold(`KBO ${date}`));
  lines.push("");
  if (games.length === 0) {
    lines.push(pc.dim("  경기 없음"));
    return lines.join("\n");
  }
  for (const g of games) {
    const time = g.gameDateTime.slice(11, 16);
    const status =
      g.statusCode === "STARTED"
        ? pc.green("● LIVE")
        : g.statusCode === "RESULT"
          ? pc.dim("종료  ")
          : g.statusCode === "READY"
            ? pc.cyan("예정  ")
            : pc.yellow(g.statusInfo || g.statusCode);
    const score =
      g.statusCode === "READY"
        ? pc.dim("      ")
        : `${String(g.awayTeamScore).padStart(2)} ${pc.dim("-")} ${String(g.homeTeamScore).padEnd(2)}`;
    const away = padStart(colorTeam(g.awayTeamName), 4);
    const home = padEnd(colorTeam(g.homeTeamName), 4);
    lines.push(`  ${status}  ${time}  ${away}  ${score}  ${home}  ${pc.dim(g.gameId)}`);
  }
  lines.push("");
  lines.push(pc.dim("  watch:  kbo watch --game <gameId>"));
  return lines.join("\n");
}
