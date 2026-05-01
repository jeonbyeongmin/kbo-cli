import pc from "picocolors";
import type { NormalizedGame, ScheduleGame } from "./types.ts";

const TEAM_COLOR: Record<string, (s: string) => string> = {
  LG: pc.red,
  두산: pc.blue,
  KIA: pc.red,
  KT: pc.white,
  삼성: pc.blue,
  한화: pc.yellow,
  SSG: pc.red,
  롯데: pc.blue,
  NC: pc.cyan,
  키움: pc.magenta,
};

function colorTeam(name: string): string {
  const fn = TEAM_COLOR[name];
  return fn ? fn(pc.bold(name)) : pc.bold(name);
}

function visualWidth(s: string): number {
  // strip ANSI
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
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

function padEnd(s: string, width: number): string {
  const w = visualWidth(s);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
}

const W = 56; // inner width of box

function frame(title: string, body: string[], footer: string): string[] {
  const top = `┌─ ${title} ${"─".repeat(Math.max(0, W - visualWidth(title) - 3))}┐`;
  const bot = `└${"─".repeat(W)}┘`;
  const lines = [top];
  for (const line of body) {
    lines.push(`│ ${padEnd(line, W - 2)} │`);
  }
  lines.push(`├${"─".repeat(W)}┤`);
  lines.push(`│ ${padEnd(footer, W - 2)} │`);
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
    `     ╱   ╲     `,
    `   ${r3 ? filled : empty}       ${r1 ? filled : empty}   `,
    `     ╲   ╱     `,
    `       ⌂       `,
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
  const awayLine = `  ${colorTeam(game.awayTeamName.padEnd(8))}  ${pc.bold(
    String(game.awayScore).padStart(2)
  )}`;
  const homeLine = `  ${colorTeam(game.homeTeamName.padEnd(8))}  ${pc.bold(
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
    body.push(left + "    " + right);
  }
  body.push("");

  // Batter / Pitcher
  if (game.status === "STARTED") {
    body.push(`  ${pc.dim("타자")}  ${game.batterName || pc.dim("?")}`);
    body.push(`  ${pc.dim("투수")}  ${game.pitcherName || pc.dim("?")}`);
    body.push("");
  }

  // Inning line score
  if (game.inningLine.away.length > 0) {
    const innings = game.inningLine.away.length;
    const headerCells = Array.from({ length: innings }, (_, i) =>
      String(i + 1).padStart(2)
    ).join(" ");
    body.push(`  ${pc.dim("회".padEnd(6))} ${pc.dim(headerCells)}`);
    const awayCells = game.inningLine.away.map((v) => v.padStart(2)).join(" ");
    const homeCells = game.inningLine.home.map((v) => v.padStart(2)).join(" ");
    body.push(`  ${game.awayTeamName.padEnd(6)} ${awayCells}`);
    body.push(`  ${game.homeTeamName.padEnd(6)} ${homeCells}`);
    body.push("");
  }

  // Recent plays
  if (game.recentPlays.length > 0) {
    body.push(pc.dim("  ─ 최근 플레이 ─"));
    for (const p of game.recentPlays.slice(0, 5)) {
      const trimmed = p.length > W - 6 ? p.slice(0, W - 8) + "…" : p;
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
        ? pc.dim("    ")
        : `${String(g.awayTeamScore).padStart(2)}:${String(g.homeTeamScore).padEnd(2)}`;
    lines.push(
      `  ${status}  ${time}  ${colorTeam(g.awayTeamName.padStart(4))} ${score} ${colorTeam(
        g.homeTeamName.padEnd(4)
      )}  ${pc.dim(g.gameId)}`
    );
  }
  lines.push("");
  lines.push(pc.dim(`  watch:  kbo watch --game <gameId>`));
  return lines.join("\n");
}
