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

// RESULT 의 하이라이트는 결과 카드와 중복되거나 의미 약한 라인을 더 정제한다.
const SIMPLE_COUNT_RE = /^\d+구\s*(볼|스트라이크|파울|타격|헛스윙|번트)/;
const RESULT_META_RE = /^(승리투수|패전투수|세이브투수|결승타|블론세이브|홀드)\s*:/;

function filterResultHighlights(plays: string[]): string[] {
  return plays.filter((p) => !SIMPLE_COUNT_RE.test(p) && !RESULT_META_RE.test(p));
}

function trimToWidth(s: string, max: number): string {
  if (visualWidth(s) <= max) return s;
  let acc = "";
  for (const ch of s) {
    if (visualWidth(acc + ch) > max - 1) break;
    acc += ch;
  }
  return `${acc}…`;
}

function teamScoreLine(name: string, score: number, suffix = ""): string {
  return `  ${padEnd(colorTeam(name), 8)}  ${pc.bold(String(score).padStart(2))}${suffix}`;
}

function inningLineSection(game: NormalizedGame): string[] {
  if (game.inningLine.away.length === 0) return [];
  const innings = game.inningLine.away.length;
  const headerCells = Array.from({ length: innings }, (_, i) => String(i + 1).padStart(2)).join(
    " "
  );
  return [
    `  ${pc.dim(padEnd("회", 6))} ${pc.dim(headerCells)}`,
    `  ${padEnd(game.awayTeamName, 6)} ${game.inningLine.away.map((v) => v.padStart(2)).join(" ")}`,
    `  ${padEnd(game.homeTeamName, 6)} ${game.inningLine.home.map((v) => v.padStart(2)).join(" ")}`,
  ];
}

function renderStartedBody(game: NormalizedGame): string[] {
  const body: string[] = [""];
  body.push(
    teamScoreLine(
      game.awayTeamName,
      game.awayScore,
      game.topBottom === "top" ? pc.cyan("  ◀ 공격") : ""
    )
  );
  body.push(
    teamScoreLine(
      game.homeTeamName,
      game.homeScore,
      game.topBottom === "bottom" ? pc.cyan("  ◀ 공격") : ""
    )
  );
  body.push("");

  const diamond = diamondLines(game.bases);
  const countBlock = [
    "",
    `  B  ${dots(game.ball, 3, pc.green)}`,
    `  S  ${dots(game.strike, 2, pc.yellow)}`,
    `  O  ${dots(game.out, 2, pc.red)}`,
    "",
  ];
  for (let i = 0; i < diamond.length; i++) {
    body.push(`${diamond[i] ?? ""}    ${countBlock[i] ?? ""}`);
  }
  body.push("");

  for (const ln of renderBatterSection(game.batterStats)) body.push(ln);
  body.push("");
  for (const ln of renderPitcherSection(game.pitcherStats)) body.push(ln);
  body.push("");

  const inningLines = inningLineSection(game);
  if (inningLines.length > 0) {
    for (const ln of inningLines) body.push(ln);
    body.push("");
  }

  if (game.recentPlays.length > 0) {
    body.push(pc.dim("  ─ 최근 플레이 ─"));
    for (const p of game.recentPlays.slice(0, 5)) {
      body.push(`  • ${trimToWidth(p, W - 4)}`);
    }
  }
  return body;
}

function renderResultBody(game: NormalizedGame): string[] {
  const body: string[] = [""];
  const awayMark = game.winner === "AWAY" ? pc.yellow("  ★") : "";
  const homeMark = game.winner === "HOME" ? pc.yellow("  ★") : "";
  body.push(teamScoreLine(game.awayTeamName, game.awayScore, awayMark));
  body.push(teamScoreLine(game.homeTeamName, game.homeScore, homeMark));
  body.push("");

  if (game.homeRheb && game.awayRheb) {
    body.push(pc.dim("  ─ 박스스코어 ─"));
    const head = ["R", "H", "E", "B"].map((c) => c.padStart(3)).join(" ");
    body.push(`  ${padEnd("", 6)} ${pc.dim(head)}`);
    const cells = (r: { r: number; h: number; e: number; b: number }) =>
      [r.r, r.h, r.e, r.b].map((n) => String(n).padStart(3)).join(" ");
    body.push(`  ${padEnd(game.awayTeamName, 6)} ${cells(game.awayRheb)}`);
    body.push(`  ${padEnd(game.homeTeamName, 6)} ${cells(game.homeRheb)}`);
    body.push("");
  }

  const resultRows: [string, string | null][] = [
    ["승리투수", game.winPitcher],
    ["패전투수", game.losePitcher],
  ];
  if (game.awayStarter || game.homeStarter) {
    resultRows.push(["선발", `${game.awayStarter ?? "?"}  vs  ${game.homeStarter ?? "?"}`]);
  }
  const visibleRows = resultRows.filter(([, v]) => v != null && v !== "");
  if (visibleRows.length > 0) {
    body.push(pc.dim("  ─ 결과 ─"));
    for (const [label, value] of visibleRows) {
      body.push(`  ${padEnd(pc.dim(label), NAME_COL)}  ${value}`);
    }
    body.push("");
  }

  const inningLines = inningLineSection(game);
  if (inningLines.length > 0) {
    for (const ln of inningLines) body.push(ln);
    body.push("");
  }

  const highlights = filterResultHighlights(game.recentPlays);
  if (highlights.length > 0) {
    body.push(pc.dim("  ─ 하이라이트 ─"));
    for (const p of highlights.slice(0, 5)) {
      body.push(`  • ${trimToWidth(p, W - 4)}`);
    }
  }
  return body;
}

function renderReadyBody(game: NormalizedGame): string[] {
  const body: string[] = [""];
  body.push(teamScoreLine(game.awayTeamName, game.awayScore));
  body.push(teamScoreLine(game.homeTeamName, game.homeScore));
  body.push("");

  if (game.awayStarter || game.homeStarter) {
    body.push(pc.dim("  ─ 선발 ─"));
    body.push(`  ${padEnd(game.awayTeamName, 6)} ${game.awayStarter ?? pc.dim("미정")}`);
    body.push(`  ${padEnd(game.homeTeamName, 6)} ${game.homeStarter ?? pc.dim("미정")}`);
    body.push("");
  }

  const time = game.gameDateTime ? game.gameDateTime.slice(11, 16) : null;
  const infoRows: [string, string | null][] = [
    ["시작", time],
    ["구장", game.stadium],
    ["날씨", game.weather],
    ["중계", game.broadChannel],
  ];
  const visibleInfo = infoRows.filter(([, v]) => v != null && v !== "");
  if (visibleInfo.length > 0) {
    body.push(pc.dim("  ─ 경기 정보 ─"));
    for (const [label, value] of visibleInfo) {
      body.push(`  ${padEnd(pc.dim(label), NAME_COL)}  ${value}`);
    }
  }
  return body;
}

export function renderGame(
  game: NormalizedGame,
  opts: { staleSec?: number; multiGame?: boolean } = {}
): string {
  const stale = opts.staleSec ?? 0;
  const headerStatus =
    game.status === "STARTED"
      ? `${inningLabel(game.inning, game.topBottom)} ${game.out}사`
      : game.status === "RESULT"
        ? "경기 종료"
        : game.status === "READY" || game.status === "BEFORE"
          ? "경기 전"
          : game.status === "CANCEL"
            ? "경기 취소"
            : game.status === "SUSPENDED"
              ? "경기 중단"
              : game.status;
  const venue = game.stadium ? pc.dim(` · ${game.stadium}`) : "";
  const staleTag = stale > 0 ? pc.yellow(` ⚠ stale ${stale}s`) : "";
  const title = `KBO LIVE · ${headerStatus}${venue}${staleTag}`;

  const body =
    game.status === "STARTED"
      ? renderStartedBody(game)
      : game.status === "RESULT"
        ? renderResultBody(game)
        : renderReadyBody(game);

  const switchHint = opts.multiGame ? "  ←/→:경기전환" : "";
  const footer = `q:종료  r:새로고침${switchHint}  · ${timeStr(game.fetchedAt)}`;
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
    const isReady = g.statusCode === "READY" || g.statusCode === "BEFORE";
    const status =
      g.statusCode === "STARTED"
        ? pc.green("● LIVE")
        : g.statusCode === "RESULT"
          ? pc.dim("종료  ")
          : isReady
            ? pc.cyan("예정  ")
            : pc.yellow(g.statusInfo || g.statusCode);
    const score = isReady
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
