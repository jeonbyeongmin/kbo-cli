import pc from "picocolors";
import type {
  BatterStats,
  GameStatus,
  NormalizedGame,
  PitcherStats,
  ScheduleGame,
} from "./types.ts";

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

export const TEAM_NAMES: readonly string[] = Object.keys(TEAM_HEX);

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
const ANSI_ESC = /\x1b\[[0-9;]*m/;
const ANSI_RE = new RegExp(ANSI_ESC.source, "g");

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

const W = 56; // inner width of box (normal 모드 기본값)

export type LayoutMode = "compact" | "normal" | "wide";

export const NARROW_THRESHOLD = 80;
export const WIDE_THRESHOLD = 120;
const WIDE_LEFT_INNER = 56;
const WIDE_GUTTER = 2;
const WIDE_RIGHT_MIN = 24;

export function isLayoutMode(v: unknown): v is LayoutMode | "auto" {
  return v === "auto" || v === "compact" || v === "normal" || v === "wide";
}

export function detectColumns(): number {
  const c = process.stdout.columns;
  if (typeof c === "number" && c > 0) return c;
  const env = Number(process.env.COLUMNS);
  if (Number.isFinite(env) && env > 0) return env;
  return 80;
}

export function pickLayoutMode(cols: number, override?: LayoutMode | "auto"): LayoutMode {
  if (override === "compact" || override === "normal" || override === "wide") {
    if (override === "wide") {
      // wide 인데 우측 컬럼 폭이 부족하면 normal 로 안전 격하.
      const rightInner = cols - 6 - WIDE_LEFT_INNER - WIDE_GUTTER;
      if (rightInner < WIDE_RIGHT_MIN) return "normal";
    }
    return override;
  }
  if (cols < NARROW_THRESHOLD) return "compact";
  if (cols < WIDE_THRESHOLD) return "normal";
  return "wide";
}

// 각 모드에서 cols 에 비례해 inner width 를 채운다 — 좌측 보더 + 우측 보더 +
// 안전 여유 합으로 4~6 cols 를 뺀다. 좌측 컬럼 폭이 고정인 wide 만 좌측 floor
// (WIDE_LEFT_INNER) 를 보장.
export function frameWidthFor(mode: LayoutMode, cols: number): number {
  if (mode === "compact") return Math.max(40, cols - 4);
  if (mode === "wide") {
    return Math.max(WIDE_LEFT_INNER + WIDE_GUTTER + WIDE_RIGHT_MIN, cols - 6);
  }
  return Math.max(W, cols - 4);
}

export function wideColumnWidths(totalInner: number): {
  left: number;
  right: number;
  gutter: number;
} {
  const right = Math.max(WIDE_RIGHT_MIN, totalInner - WIDE_LEFT_INNER - WIDE_GUTTER);
  return { left: WIDE_LEFT_INNER, right, gutter: WIDE_GUTTER };
}

const RESIZE_DEBOUNCE_MS = 50;

// SIGWINCH 를 50ms 디바운스해 handler 호출. 반환값은 cleanup 함수.
// alt-screen 루프 종료 시 호출해 process listener 누수를 막는다.
export function onResize(handler: () => void): () => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      handler();
    }, RESIZE_DEBOUNCE_MS);
  };
  process.on("SIGWINCH", fire);
  return () => {
    if (t) clearTimeout(t);
    t = null;
    process.removeListener("SIGWINCH", fire);
  };
}

// 두 컬럼 string[] 을 줄 단위 zip 해 한 배열로 합친다. 좌측은 leftWidth 로 padEnd
// 되어 우측 시작 위치가 일정하고, 짧은 컬럼은 빈 줄로 늘여진다.
function joinColumns(left: string[], right: string[], leftWidth: number, gutter = 2): string[] {
  const len = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    const l = left[i] ?? "";
    const r = right[i] ?? "";
    out.push(`${padEnd(l, leftWidth)}${" ".repeat(gutter)}${r}`);
  }
  return out;
}

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

function compactDiamond(bases: { first: boolean; second: boolean; third: boolean }): string {
  const fill = pc.yellow("◆");
  const empty = pc.dim("◇");
  return `2:${bases.second ? fill : empty}  3:${bases.third ? fill : empty}  1:${bases.first ? fill : empty}`;
}

export function compactCountLine(ball: number, strike: number, out: number): string {
  return `B ${dots(ball, 3, pc.green)}  S ${dots(strike, 2, pc.yellow)}  O ${dots(out, 2, pc.red)}`;
}

export function dots(filled: number, total: number, color: (s: string) => string): string {
  const out: string[] = [];
  for (let i = 0; i < total; i++) out.push(i < filled ? color("●") : pc.dim("○"));
  return out.join("");
}

export function inningLabel(inning: number, topBottom: "top" | "bottom"): string {
  return `${inning}회${topBottom === "top" ? "초" : "말"}`;
}

function timeStr(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

const NAME_COL = 10;

const ANSI_TOKEN_RE = new RegExp(`(${ANSI_ESC.source})|([\\s\\S])`, "g");

export function trimToWidth(s: string, max: number): string {
  if (visualWidth(s) <= max) return s;
  let acc = "";
  let w = 0;
  let m: RegExpExecArray | null;
  ANSI_TOKEN_RE.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex token loop
  while ((m = ANSI_TOKEN_RE.exec(s)) !== null) {
    if (m[1]) {
      acc += m[1];
      continue;
    }
    const ch = m[2]!;
    const cw = visualWidth(ch);
    if (w + cw > max - 1) return `${acc}…`;
    acc += ch;
    w += cw;
  }
  return s;
}

export function truncName(name: string): string {
  return trimToWidth(name, NAME_COL);
}

function renderBatterSection(b: BatterStats | null, compact: boolean): string[] {
  const lines: string[] = [];
  lines.push(pc.dim("  ─ 타자 ─"));
  if (!b) {
    lines.push(`  ${pc.dim("?")}`);
    return lines;
  }
  const nameCell = padEnd(truncName(b.name || "?"), NAME_COL);
  const seasonPart = b.seasonAvg ? `시즌 AVG ${b.seasonAvg}` : pc.dim("시즌 기록 없음");
  lines.push(`  ${nameCell}  ${seasonPart}`);
  if (compact) return lines;
  if (b.todayLine) {
    const tail = b.todayAvg ? `  ${pc.dim(`(AVG ${b.todayAvg})`)}` : "";
    lines.push(`  ${padEnd(pc.dim("오늘"), NAME_COL)}  ${b.todayLine}${tail}`);
  }
  if (b.vsPitcher) {
    lines.push(`  ${padEnd(pc.dim("vs투수"), NAME_COL)}  ${pc.dim(b.vsPitcher)}`);
  }
  return lines;
}

function renderPitcherSection(p: PitcherStats | null, compact: boolean): string[] {
  const lines: string[] = [];
  lines.push(pc.dim("  ─ 투수 ─"));
  if (!p) {
    lines.push(`  ${pc.dim("?")}`);
    return lines;
  }
  const nameCell = padEnd(truncName(p.name || "?"), NAME_COL);
  const seasonPart = p.seasonEra ? `시즌 ERA ${p.seasonEra}` : pc.dim("시즌 기록 없음");
  lines.push(`  ${nameCell}  ${seasonPart}`);
  if (compact) return lines;
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

function teamScoreLine(name: string, score: number, suffix = ""): string {
  return `  ${padEnd(colorTeam(name), 8)}  ${pc.bold(String(score).padStart(2))}${suffix}`;
}

function labelValueRows(rows: [string, string | null | undefined][]): string[] {
  return rows
    .filter(([, v]) => v != null && v !== "")
    .map(([label, value]) => `  ${padEnd(pc.dim(label), NAME_COL)}  ${value}`);
}

function inningLineSection(game: NormalizedGame, ctx: RenderCtx): string[] {
  if (game.inningLine.away.length === 0) return [];
  const innings = game.inningLine.away.length;
  // compact 에선 4회 단위로 줄바꿈해 좁은 폭에서도 정렬 유지.
  const chunkSize = ctx.mode === "compact" ? 4 : innings;
  const out: string[] = [];
  for (let i = 0; i < innings; i += chunkSize) {
    const len = Math.min(chunkSize, innings - i);
    const headerCells = Array.from({ length: len }, (_, k) => String(i + k + 1).padStart(2)).join(
      " "
    );
    const awaySlice = game.inningLine.away
      .slice(i, i + len)
      .map((v) => v.padStart(2))
      .join(" ");
    const homeSlice = game.inningLine.home
      .slice(i, i + len)
      .map((v) => v.padStart(2))
      .join(" ");
    out.push(`  ${pc.dim(padEnd("회", 6))} ${pc.dim(headerCells)}`);
    out.push(`  ${padEnd(game.awayTeamName, 6)} ${awaySlice}`);
    out.push(`  ${padEnd(game.homeTeamName, 6)} ${homeSlice}`);
    if (i + chunkSize < innings) out.push("");
  }
  return out;
}

interface RenderCtx {
  mode: LayoutMode;
  innerWidth: number;
  rightInner?: number;
}

function renderStartedBodyWide(game: NormalizedGame, ctx: RenderCtx, rightInner: number): string[] {
  const left: string[] = [""];
  left.push(
    teamScoreLine(
      game.awayTeamName,
      game.awayScore,
      game.topBottom === "top" ? pc.cyan("  ◀ 공격") : ""
    )
  );
  left.push(
    teamScoreLine(
      game.homeTeamName,
      game.homeScore,
      game.topBottom === "bottom" ? pc.cyan("  ◀ 공격") : ""
    )
  );
  left.push("");
  for (const ln of diamondLines(game.bases)) left.push(ln);
  left.push(`  ${compactCountLine(game.ball, game.strike, game.out)}`);
  left.push("");
  const inningLines = inningLineSection(game, { ...ctx, mode: "normal" });
  for (const ln of inningLines) left.push(ln);

  const right: string[] = [""];
  for (const ln of renderBatterSection(game.batterStats, false)) {
    right.push(trimToWidth(ln, rightInner));
  }
  right.push("");
  for (const ln of renderPitcherSection(game.pitcherStats, false)) {
    right.push(trimToWidth(ln, rightInner));
  }
  right.push("");
  if (game.recentPlays.length > 0) {
    right.push(pc.dim("  ─ 최근 플레이 ─"));
    for (const p of game.recentPlays.slice(0, 7)) {
      right.push(trimToWidth(`  • ${p}`, rightInner));
    }
  }
  return joinColumns(left, right, WIDE_LEFT_INNER);
}

function renderStartedBody(game: NormalizedGame, ctx: RenderCtx): string[] {
  if (ctx.mode === "wide" && ctx.rightInner != null) {
    return renderStartedBodyWide(game, ctx, ctx.rightInner);
  }
  const compact = ctx.mode === "compact";
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

  if (compact) {
    body.push(`  ${compactDiamond(game.bases)}`);
    body.push(`  ${compactCountLine(game.ball, game.strike, game.out)}`);
    body.push("");
  } else {
    for (const ln of diamondLines(game.bases)) body.push(ln);
    body.push(`  ${compactCountLine(game.ball, game.strike, game.out)}`);
    body.push("");
  }

  for (const ln of renderBatterSection(game.batterStats, compact)) body.push(ln);
  body.push("");
  for (const ln of renderPitcherSection(game.pitcherStats, compact)) body.push(ln);
  body.push("");

  const inningLines = inningLineSection(game, ctx);
  if (inningLines.length > 0) {
    for (const ln of inningLines) body.push(ln);
    body.push("");
  }

  if (game.recentPlays.length > 0) {
    body.push(pc.dim("  ─ 최근 플레이 ─"));
    const limit = compact ? 3 : 5;
    for (const p of game.recentPlays.slice(0, limit)) {
      body.push(`  • ${trimToWidth(p, ctx.innerWidth - 4)}`);
    }
  }
  return body;
}

function renderResultBodyWide(game: NormalizedGame, ctx: RenderCtx, rightInner: number): string[] {
  const left: string[] = [""];
  const awayMark = game.winner === "AWAY" ? pc.yellow("  ★") : "";
  const homeMark = game.winner === "HOME" ? pc.yellow("  ★") : "";
  left.push(teamScoreLine(game.awayTeamName, game.awayScore, awayMark));
  left.push(teamScoreLine(game.homeTeamName, game.homeScore, homeMark));
  left.push("");
  if (game.homeRheb && game.awayRheb) {
    left.push(pc.dim("  ─ 박스스코어 ─"));
    const head = ["R", "H", "E", "B"].map((c) => c.padStart(3)).join(" ");
    left.push(`  ${padEnd("", 6)} ${pc.dim(head)}`);
    const cells = (r: { r: number; h: number; e: number; b: number }) =>
      [r.r, r.h, r.e, r.b].map((n) => String(n).padStart(3)).join(" ");
    left.push(`  ${padEnd(game.awayTeamName, 6)} ${cells(game.awayRheb)}`);
    left.push(`  ${padEnd(game.homeTeamName, 6)} ${cells(game.homeRheb)}`);
    left.push("");
  }
  const starterMatch =
    game.awayStarter || game.homeStarter
      ? `${game.awayStarter ?? "?"}  vs  ${game.homeStarter ?? "?"}`
      : null;
  const resultLines = labelValueRows([
    ["승리투수", game.winPitcher],
    ["패전투수", game.losePitcher],
    ["선발", starterMatch],
  ]);
  if (resultLines.length > 0) {
    left.push(pc.dim("  ─ 결과 ─"));
    for (const ln of resultLines) left.push(ln);
    left.push("");
  }
  const inningLines = inningLineSection(game, { ...ctx, mode: "normal" });
  for (const ln of inningLines) left.push(ln);

  const right: string[] = [""];
  const highlights = filterResultHighlights(game.recentPlays);
  if (highlights.length > 0) {
    right.push(pc.dim("  ─ 하이라이트 ─"));
    for (const p of highlights.slice(0, 10)) {
      right.push(trimToWidth(`  • ${p}`, rightInner));
    }
  }
  return joinColumns(left, right, WIDE_LEFT_INNER);
}

function renderResultBody(game: NormalizedGame, ctx: RenderCtx): string[] {
  if (ctx.mode === "wide" && ctx.rightInner != null) {
    return renderResultBodyWide(game, ctx, ctx.rightInner);
  }
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

  const starterMatch =
    game.awayStarter || game.homeStarter
      ? `${game.awayStarter ?? "?"}  vs  ${game.homeStarter ?? "?"}`
      : null;
  const resultLines = labelValueRows([
    ["승리투수", game.winPitcher],
    ["패전투수", game.losePitcher],
    ["선발", starterMatch],
  ]);
  if (resultLines.length > 0) {
    body.push(pc.dim("  ─ 결과 ─"));
    for (const ln of resultLines) body.push(ln);
    body.push("");
  }

  const inningLines = inningLineSection(game, ctx);
  if (inningLines.length > 0) {
    for (const ln of inningLines) body.push(ln);
    body.push("");
  }

  const highlights = filterResultHighlights(game.recentPlays);
  if (highlights.length > 0) {
    body.push(pc.dim("  ─ 하이라이트 ─"));
    const limit = ctx.mode === "compact" ? 3 : 5;
    for (const p of highlights.slice(0, limit)) {
      body.push(`  • ${trimToWidth(p, ctx.innerWidth - 4)}`);
    }
  }
  return body;
}

function readyInfoLines(game: NormalizedGame): string[] {
  return labelValueRows([
    ["시작", game.gameDateTime ? game.gameDateTime.slice(11, 16) : null],
    ["구장", game.stadium],
    ["날씨", game.weather],
    ["중계", game.broadChannel],
  ]);
}

function renderReadyBody(game: NormalizedGame, ctx: RenderCtx): string[] {
  const infoLines = readyInfoLines(game);
  // wide 인데 우측 정보가 부족하면 normal 로 격하해 휑함을 피한다.
  if (ctx.mode === "wide" && ctx.rightInner != null && infoLines.length >= 3) {
    const left: string[] = [""];
    left.push(teamScoreLine(game.awayTeamName, game.awayScore));
    left.push(teamScoreLine(game.homeTeamName, game.homeScore));
    left.push("");
    if (game.awayStarter || game.homeStarter) {
      left.push(pc.dim("  ─ 선발 ─"));
      left.push(`  ${padEnd(game.awayTeamName, 6)} ${game.awayStarter ?? pc.dim("미정")}`);
      left.push(`  ${padEnd(game.homeTeamName, 6)} ${game.homeStarter ?? pc.dim("미정")}`);
    }
    const right: string[] = [""];
    right.push(pc.dim("  ─ 경기 정보 ─"));
    for (const ln of infoLines) right.push(trimToWidth(ln, ctx.rightInner));
    return joinColumns(left, right, WIDE_LEFT_INNER);
  }

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

  if (infoLines.length > 0) {
    body.push(pc.dim("  ─ 경기 정보 ─"));
    for (const ln of infoLines) body.push(ln);
  }
  return body;
}

const HEADER_LABEL: Record<GameStatus, (g: NormalizedGame) => string> = {
  STARTED: (g) => `${inningLabel(g.inning, g.topBottom)} ${g.out}사`,
  RESULT: () => "경기 종료",
  READY: () => "경기 전",
  BEFORE: () => "경기 전",
  CANCEL: () => "경기 취소",
  SUSPENDED: () => "경기 중단",
};

const BODY_RENDERERS: Record<GameStatus, (g: NormalizedGame, ctx: RenderCtx) => string[]> = {
  STARTED: renderStartedBody,
  RESULT: renderResultBody,
  READY: renderReadyBody,
  BEFORE: renderReadyBody,
  CANCEL: renderReadyBody,
  SUSPENDED: renderReadyBody,
};

export function renderGame(
  game: NormalizedGame,
  opts: { staleSec?: number; multiGame?: boolean; layout?: LayoutMode | "auto" } = {}
): string {
  const stale = opts.staleSec ?? 0;
  const cols = detectColumns();
  const mode = pickLayoutMode(cols, opts.layout);
  const innerWidth = frameWidthFor(mode, cols);
  const headerStatus = HEADER_LABEL[game.status](game);
  const venue = game.stadium ? pc.dim(` · ${game.stadium}`) : "";
  const staleTag = stale > 0 ? pc.yellow(` ⚠ stale ${stale}s`) : "";
  const title = `KBO LIVE · ${headerStatus}${venue}${staleTag}`;

  const ctx: RenderCtx = { mode, innerWidth };
  if (mode === "wide") {
    ctx.rightInner = wideColumnWidths(innerWidth).right;
  }
  const body = BODY_RENDERERS[game.status](game, ctx);

  const switchHint = opts.multiGame ? "  ←/→:경기전환" : "";
  const footer = `q:종료  r:새로고침${switchHint}  · ${timeStr(game.fetchedAt)}`;
  return frame(title, body, footer, innerWidth).join("\n");
}

export function renderScheduleList(
  games: ScheduleGame[],
  date: string,
  favoriteTeam?: string
): string {
  const lines: string[] = [];
  lines.push(pc.bold(`KBO ${date}`));
  lines.push("");
  if (games.length === 0) {
    lines.push(pc.dim("  경기 없음"));
    return lines.join("\n");
  }
  // 즐겨찾기 팀 경기를 상단으로 끌어올린다 — Array.sort 안정 정렬이라 같은 그룹 내부 순서는 보존.
  const sorted = favoriteTeam
    ? [...games].sort((a, b) => {
        const af = a.homeTeamName === favoriteTeam || a.awayTeamName === favoriteTeam ? 0 : 1;
        const bf = b.homeTeamName === favoriteTeam || b.awayTeamName === favoriteTeam ? 0 : 1;
        return af - bf;
      })
    : games;
  for (const g of sorted) {
    const isFavorite =
      !!favoriteTeam && (g.homeTeamName === favoriteTeam || g.awayTeamName === favoriteTeam);
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
    const prefix = isFavorite ? pc.cyan("▶ ") : "  ";
    lines.push(`${prefix}${status}  ${time}  ${away}  ${score}  ${home}  ${pc.dim(g.gameId)}`);
  }
  lines.push("");
  lines.push(pc.dim("  watch:  kbo watch --game <gameId>"));
  return lines.join("\n");
}
