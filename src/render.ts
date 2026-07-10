import pc from "picocolors";
import { centerAlign, padEnd, padStart, trimToWidth, visualWidth } from "./text.ts";
import type {
  BatterStats,
  GameStatus,
  NormalizedGame,
  PitcherStats,
  RHEB,
  ScheduleGame,
} from "./types.ts";
import { lineupRows, strikeZoneChart, winRateBar } from "./widgets.ts";

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

// 팀 hex 를 전경색으로 쓰되, 검정(KT)·남색(두산)처럼 어두운 팀은 채도를 유지한
// 채 최대 채널을 150 이상으로 끌어올려 어두운 터미널 배경에서도 보이게 한다.
function brightHex(hex: string): [number, number, number] {
  let r = Number.parseInt(hex.slice(1, 3), 16);
  let g = Number.parseInt(hex.slice(3, 5), 16);
  let b = Number.parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  if (max === 0) return [150, 150, 150]; // 순수 검정 → 회색
  if (max < 150) {
    const f = 150 / max;
    r = Math.round(r * f);
    g = Math.round(g * f);
    b = Math.round(b * f);
  }
  return [r, g, b];
}

// 팀 컬러 전경 (truecolor). 대형 숫자·강조에 사용.
function teamFg(name: string): (s: string) => string {
  const hex = TEAM_HEX[name];
  if (!hex || !pc.isColorSupported) return (s) => s;
  const [r, g, b] = brightHex(hex);
  const open = `\x1b[38;2;${r};${g};${b}m`;
  return (s) => `${open}${s}\x1b[39m`;
}

// 솔리드 컬러 배너. 팀 식별색을 배경으로 깔아 스코어보드 상단 라벨로 쓴다.
function teamBanner(name: string): string {
  const display = TEAM_DISPLAY[name] ?? name;
  const fn = TEAM_COLOR[name];
  const label = ` ${display} `;
  return fn ? fn(pc.bold(label)) : pc.bold(`▐${label}▌`);
}

// 4×8 픽셀 숫자 폰트 — 하프블록(▀▄█)으로 4행 렌더. 기존 3×5 █ 폰트보다
// 도트 밀도가 2배라 실제 전광판 LED 질감이 난다.
const BIG_FONT_PIXELS: Record<string, string[]> = {
  "0": ["####", "#..#", "#..#", "#..#", "#..#", "#..#", "#..#", "####"],
  "1": ["..#.", ".##.", "..#.", "..#.", "..#.", "..#.", "..#.", ".###"],
  "2": ["####", "...#", "...#", "####", "#...", "#...", "#...", "####"],
  "3": ["####", "...#", "...#", ".###", "...#", "...#", "...#", "####"],
  "4": ["#..#", "#..#", "#..#", "####", "...#", "...#", "...#", "...#"],
  "5": ["####", "#...", "#...", "####", "...#", "...#", "...#", "####"],
  "6": ["####", "#...", "#...", "####", "#..#", "#..#", "#..#", "####"],
  "7": ["####", "...#", "...#", "...#", "...#", "...#", "...#", "...#"],
  "8": ["####", "#..#", "#..#", "####", "#..#", "#..#", "#..#", "####"],
  "9": ["####", "#..#", "#..#", "####", "...#", "...#", "...#", "####"],
  " ": ["....", "....", "....", "....", "....", "....", "....", "...."],
};

export const BIG_DIGIT_ROWS = 4;

// 픽셀 2행 → 하프블록 1행: 상+하 █, 상 ▀, 하 ▄.
function toHalfBlocks(pixels: string[]): string[] {
  const rows: string[] = [];
  for (let r = 0; r < pixels.length; r += 2) {
    let line = "";
    for (let c = 0; c < pixels[r]!.length; c++) {
      const top = pixels[r]![c] === "#";
      const bottom = pixels[r + 1]?.[c] === "#";
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    rows.push(line);
  }
  return rows;
}

const BIG_FONT: Record<string, string[]> = Object.fromEntries(
  Object.entries(BIG_FONT_PIXELS).map(([k, v]) => [k, toHalfBlocks(v)])
);

// 정수를 4행 하프블록 숫자로. 각 자리 4폭 + 자리 사이 1칸 공백.
export function bigDigits(n: number, color: (s: string) => string): string[] {
  const s = String(n);
  const rows = Array.from({ length: BIG_DIGIT_ROWS }, () => "");
  for (let ci = 0; ci < s.length; ci++) {
    const glyph = BIG_FONT[s[ci]!] ?? BIG_FONT[" "]!;
    for (let i = 0; i < BIG_DIGIT_ROWS; i++) rows[i] += (ci > 0 ? " " : "") + glyph[i];
  }
  return rows.map((r) => color(r));
}

// 하위 호환 re-export — 기존 소비처(index.ts, 테스트)가 render.ts 에서 import 한다.
export { padEnd, padStart, trimToWidth, visualWidth } from "./text.ts";

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

// 높이 감지. 0 = 높이 무제한 (파이프/CI/테스트) — 이때 렌더는 기존과 동일하게 동작한다.
export function detectRows(): number {
  const r = process.stdout.rows;
  if (typeof r === "number" && r > 0) return r;
  const env = Number(process.env.LINES);
  if (Number.isFinite(env) && env > 0) return env;
  return 0;
}

// ─── 높이 인지 조립 ─────────────────────────────────────────────
// 본문을 섹션 단위로 만들고 fitBody 가 터미널 높이 예산에 맞춘다.
// alt 는 1단계 축소형. degradeOrder 에 같은 id 가 다시 오면 통째 생략.
interface Section {
  id: string;
  lines: string[];
  alt?: string[];
}

// 최근 플레이(또는 하이라이트)는 유일한 가변 높이 섹션 — 남는 세로 공간을 흡수한다.
interface FlexSection {
  min: number;
  base: number; // 높이 무제한(비 TTY)일 때의 기존 기본 viewport
  max: number;
  render: (viewport: number) => string[];
}

function fitBody(
  sections: Section[],
  budget: number,
  flex: FlexSection | null,
  degradeOrder: string[]
): { lines: string[]; viewport: number } {
  const state = new Map<string, "alt" | "omit">();
  let stripGaps = false;

  const build = (viewport: number): string[] => {
    const out: string[] = [];
    for (const s of sections) {
      let ls: string[];
      if (s.id === "recent") ls = flex && viewport > 0 ? flex.render(viewport) : [];
      else {
        const st = state.get(s.id);
        ls = st === "omit" ? [] : st === "alt" && s.alt ? s.alt : s.lines;
      }
      if (stripGaps) ls = ls.filter((l) => l.trim() !== "");
      out.push(...ls);
    }
    if (!stripGaps && state.size === 0) return out; // 무강등 — 기존 출력 그대로
    // 강등으로 생긴 연속/말단 빈 줄 정리 (선두 패딩 빈 줄은 유지)
    const cleaned: string[] = [];
    for (const l of out) {
      const blank = l.trim() === "";
      if (blank && cleaned.length > 0 && cleaned[cleaned.length - 1]!.trim() === "") continue;
      cleaned.push(l);
    }
    while (cleaned.length > 1 && cleaned[cleaned.length - 1]!.trim() === "") cleaned.pop();
    return cleaned;
  };

  if (!Number.isFinite(budget)) {
    const v = flex ? Math.min(flex.base, flex.max) : 0;
    return { lines: build(v), viewport: v };
  }

  const tryFit = (): { lines: string[]; viewport: number } | null => {
    if (!flex) {
      const lines = build(0);
      return lines.length <= budget ? { lines, viewport: 0 } : null;
    }
    for (let v = Math.min(flex.max, budget); v >= flex.min; v--) {
      const lines = build(v);
      if (lines.length <= budget) return { lines, viewport: v };
    }
    return null;
  };

  let res = tryFit();
  if (!res) {
    for (const step of ["gaps", ...degradeOrder]) {
      if (step === "gaps") stripGaps = true;
      else {
        const s = sections.find((x) => x.id === step);
        if (!s) continue;
        state.set(step, s.alt && state.get(step) == null ? "alt" : "omit");
      }
      res = tryFit();
      if (res) break;
    }
  }
  if (!res) {
    // 최후 수단: 최소 구성으로 조립 후 하드 트림 (터미널이 극단적으로 낮을 때)
    const v = flex ? flex.min : 0;
    res = { lines: build(v).slice(0, Math.max(1, budget)), viewport: v };
  }
  return res;
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
  innerWidth: number = W,
  ticker?: string
): string[] {
  const top = `┌─ ${title} ${"─".repeat(Math.max(0, innerWidth - visualWidth(title) - 3))}┐`;
  const bot = `└${"─".repeat(innerWidth)}┘`;
  const lines = [top];
  for (const line of body) {
    lines.push(`│ ${padEnd(line, innerWidth - 2)} │`);
  }
  // 멀티게임 티커 — 푸터 위 전용 행.
  if (ticker) {
    lines.push(`├${"─".repeat(innerWidth)}┤`);
    lines.push(`│ ${padEnd(trimToWidth(ticker, innerWidth - 2), innerWidth - 2)} │`);
  }
  lines.push(`├${"─".repeat(innerWidth)}┤`);
  lines.push(`│ ${padEnd(footer, innerWidth - 2)} │`);
  lines.push(bot);
  return lines;
}

// 다른 경기 요약 한 줄 — "두산 3-5 LG ●7회 · KT 1-0 SSG 종료".
export function tickerLine(others: ScheduleGame[]): string {
  const segs = others.map((g) => {
    const isReady = g.statusCode === "READY" || g.statusCode === "BEFORE";
    const status =
      g.statusCode === "STARTED"
        ? pc.green(`●${g.currentInning ?? "LIVE"}`)
        : g.statusCode === "RESULT"
          ? pc.dim("종료")
          : isReady
            ? pc.cyan(g.gameDateTime.slice(11, 16))
            : pc.yellow(g.statusInfo || g.statusCode);
    const score = isReady ? "" : ` ${g.awayTeamScore}-${g.homeTeamScore}`;
    return `${colorTeam(g.awayTeamName)}${score} ${colorTeam(g.homeTeamName)} ${status}`;
  });
  return segs.join(pc.dim("  ·  "));
}

// 렌더에 얹는 모션 상태. watch 의 애니메이션 루프가 프레임마다 계산해 넘긴다.
// 정적 렌더(fixture/test)에선 전부 생략 → 기존과 동일한 정지 화면.
export interface RenderAnim {
  pulse?: number; // 0..1 — LIVE 인디케이터 맥동
  flash?: { side: "away" | "home"; level: number }; // 득점 팀 대형숫자 플래시 (level 1→0)
  runners?: { toBase: "first" | "second" | "third" | "home"; t: number }[]; // 진루 이동 (t 0→1)
}

// 브라유(셀당 2×4 서브픽셀) 도트 비트 배치.
const BRAILLE_DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

// 야구장을 브라유로 래스터라이즈한다. path(베이스라인/마운드)·fence(외야 펜스)·
// run(진루 애니 점) 3 레이어를 셀 단위로 OR 한 뒤 우선순위 색(run>fence>path)으로
// 칠하고, 베이스 위치는 브라유 대신 문자 글리프(◆/◇/⌂)로 치환해 또렷하게 표시한다.
const FIELD_W = 48;
const FIELD_H = 44;
const FIELD_COLS = FIELD_W / 2; // 24
const FIELD_ROWS = FIELD_H / 4; // 11
const FIELD_V = {
  home: [24, 41],
  first: [43, 25],
  second: [24, 9],
  third: [5, 25],
} as const;
// 다이아몬드 렌더 폭 (들여쓰기 3 + 셀 24) — 옆에 투구 차트를 붙일 때 기준.
const FIELD_DISPLAY_W = 3 + FIELD_COLS;
// 다이아몬드와 투구 차트 사이 간격.
const FIELD_ZONE_GAP = 5;

function diamondField(
  bases: { first: boolean; second: boolean; third: boolean },
  anim?: RenderAnim
): string[] {
  const path = new Uint8Array(FIELD_COLS * FIELD_ROWS);
  const fence = new Uint8Array(FIELD_COLS * FIELD_ROWS);
  const run = new Uint8Array(FIELD_COLS * FIELD_ROWS);

  const dot = (grid: Uint8Array, x: number, y: number): void => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= FIELD_W || yi >= FIELD_H) return;
    grid[Math.floor(yi / 4) * FIELD_COLS + Math.floor(xi / 2)]! |= BRAILLE_DOTS[yi % 4]![xi % 2];
  };
  const segment = (grid: Uint8Array, a: readonly number[], b: readonly number[]): void => {
    let x0 = Math.round(a[0]!);
    let y0 = Math.round(a[1]!);
    const x1 = Math.round(b[0]!);
    const y1 = Math.round(b[1]!);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      dot(grid, x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  };
  const mark = (grid: Uint8Array, p: readonly number[]): void => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) dot(grid, p[0]! + dx, p[1]! + dy);
  };

  // 내야 베이스라인.
  segment(path, FIELD_V.home, FIELD_V.first);
  segment(path, FIELD_V.first, FIELD_V.second);
  segment(path, FIELD_V.second, FIELD_V.third);
  segment(path, FIELD_V.third, FIELD_V.home);
  // 마운드 — 내야 중앙의 점.
  dot(path, 23, 27);
  dot(path, 25, 27);
  dot(path, 24, 28);
  // 외야 펜스 — 좌우 파울 폴에서 가운데 담장으로 이어지는 아크 (2차 베지어).
  // 베이스라인·2루와 겹치지 않게 위쪽에 얕게 띄운다.
  const fA = [2, 12] as const;
  const fC = [24, -10] as const; // control point (화면 밖 위쪽)
  const fB = [46, 12] as const;
  for (let t = 0; t <= 1.001; t += 0.02) {
    const mt = 1 - t;
    const x = mt * mt * fA[0] + 2 * mt * t * fC[0] + t * t * fB[0];
    const y = mt * mt * fA[1] + 2 * mt * t * fC[1] + t * t * fB[1];
    dot(fence, x, y);
  }

  // 진루 애니: 홈→목표 베이스 경로를 따라 이동하는 밝은 점.
  if (anim?.runners?.length) {
    const wp = [FIELD_V.home, FIELD_V.first, FIELD_V.second, FIELD_V.third, FIELD_V.home];
    const endIdx = { first: 1, second: 2, third: 3, home: 4 } as const;
    for (const rnr of anim.runners) {
      const end = endIdx[rnr.toBase];
      const s = Math.max(0, Math.min(1, rnr.t)) * end;
      const i = Math.min(end - 1, Math.floor(s));
      const f = s - i;
      mark(run, [
        wp[i]![0]! + (wp[i + 1]![0]! - wp[i]![0]!) * f,
        wp[i]![1]! + (wp[i + 1]![1]! - wp[i]![1]!) * f,
      ]);
    }
  }

  // 셀 단위 렌더 후 베이스 위치를 문자 글리프로 치환.
  const cells: string[][] = [];
  for (let r = 0; r < FIELD_ROWS; r++) {
    const rowCells: string[] = [];
    for (let c = 0; c < FIELD_COLS; c++) {
      const idx = r * FIELD_COLS + c;
      const val = path[idx]! | fence[idx]! | run[idx]!;
      if (val === 0) {
        rowCells.push(" ");
        continue;
      }
      const glyph = String.fromCharCode(0x2800 + val);
      if (run[idx]) rowCells.push(pc.bold(pc.yellow(glyph)));
      else if (fence[idx]) rowCells.push(pc.green(pc.dim(glyph)));
      else rowCells.push(pc.dim(glyph));
    }
    cells.push(rowCells);
  }
  const baseCell = (v: readonly number[]) =>
    [Math.floor(v[1]! / 4), Math.floor(v[0]! / 2)] as const;
  const putBase = (v: readonly number[], occupied: boolean) => {
    const [r, c] = baseCell(v);
    cells[r]![c] = occupied ? pc.bold(pc.yellow("◆")) : pc.dim("◇");
  };
  putBase(FIELD_V.first, bases.first);
  putBase(FIELD_V.second, bases.second);
  putBase(FIELD_V.third, bases.third);
  const [hr, hc] = baseCell(FIELD_V.home);
  cells[hr]![hc] = pc.cyan("⌂");

  return cells.map((rowCells) => `   ${rowCells.join("")}`);
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

// 대형 숫자 색. 득점 플래시 중인 쪽은 팀색↔볼드 화이트로 몇 번 깜빡인다.
function flashColor(
  name: string,
  side: "away" | "home",
  flash?: RenderAnim["flash"]
): (s: string) => string {
  if (flash && flash.side === side) {
    const on = Math.floor((1 - flash.level) * 8) % 2 === 0;
    if (on) return (s) => pc.bold(pc.white(s));
  }
  return teamFg(name);
}

// 대형 스코어보드 헤더 (normal/wide). 좌=원정 대형 숫자, 우=홈 대형 숫자,
// 가운데=경기 상태(이닝/공격/아웃 등), 양끝=팀색 세로 스트립.
// 배너 1줄 + 숫자 4줄 = 5줄 반환.
function scoreHeaderBig(
  awayName: string,
  homeName: string,
  awayScore: number,
  homeScore: number,
  centerLines: string[],
  innerWidth: number,
  opts: { awayTag?: string; homeTag?: string; flash?: RenderAnim["flash"] } = {}
): string[] {
  const awayBig = bigDigits(awayScore, flashColor(awayName, "away", opts.flash));
  const homeBig = bigDigits(homeScore, flashColor(homeName, "home", opts.flash));
  // 팀색 배경 세로 스트립 — 전광판 프레임 느낌 + 팀 식별 강화.
  const stripAway = (TEAM_COLOR[awayName] ?? pc.dim)(" ");
  const stripHome = (TEAM_COLOR[homeName] ?? pc.dim)(" ");

  // 좌/우 존은 대칭, 가운데는 나머지. 좁은 normal 에서도 최소 폭 확보.
  const side = Math.min(22, Math.max(12, Math.floor((innerWidth - 16) / 2)));
  const center = Math.max(10, innerWidth - side * 2);

  const awayTag = opts.awayTag ?? pc.dim("원정");
  const homeTag = opts.homeTag ?? pc.dim("홈");
  const bannerRight = `${homeTag} ${teamBanner(homeName)}`;
  const bannerLeft = `  ${teamBanner(awayName)} ${awayTag}`;
  const bannerRow = padEnd(bannerLeft, innerWidth - visualWidth(bannerRight)) + bannerRight;

  const rows = [bannerRow];
  for (let i = 0; i < BIG_DIGIT_ROWS; i++) {
    // 원정 숫자는 가운데 쪽으로 우측정렬, 홈 숫자는 가운데 쪽으로 좌측정렬 —
    // 실제 전광판처럼 두 점수가 가운데를 마주보게. 바깥쪽 끝에 팀색 스트립.
    const leftCell = stripAway + padEnd(padStart(awayBig[i]!, side - 4), side - 1);
    const rightCell = padStart(padEnd(homeBig[i]!, side - 4), side - 1) + stripHome;
    const centerCell = centerAlign(centerLines[i] ?? "", center);
    rows.push(leftCell + centerCell + rightCell);
  }
  return rows;
}

// compact 헤더: 배너 + 한 줄 점수. 대형 숫자는 좁은 폭에 안 맞아 생략.
function scoreHeaderCompact(
  awayName: string,
  homeName: string,
  awayScore: number,
  homeScore: number,
  awaySuffix = "",
  homeSuffix = ""
): string[] {
  const bw = Math.max(visualWidth(teamBanner(awayName)), visualWidth(teamBanner(homeName)));
  const row = (name: string, score: number, suffix: string) =>
    `  ${padEnd(teamBanner(name), bw)}  ${teamFg(name)(pc.bold(String(score).padStart(2)))}${suffix}`;
  return [row(awayName, awayScore, awaySuffix), row(homeName, homeScore, homeSuffix)];
}

// STARTED 가운데 열: 이닝 / 공격 방향 / 아웃카운트를 세로로 (숫자 4행에 맞춤).
function startedCenterLines(game: NormalizedGame): string[] {
  const inning = pc.bold(inningLabel(game.inning, game.topBottom));
  const attack = game.topBottom === "top" ? pc.cyan("◀ 공격") : pc.cyan("공격 ▶");
  const outs = `${pc.red("●".repeat(game.out))}${pc.dim("○".repeat(Math.max(0, 3 - game.out)))} ${pc.dim(`${game.out}아웃`)}`;
  return ["", inning, attack, outs];
}

// 미니 박스 패널. wide 우측 컬럼의 타자/투수 카드용.
function panel(title: string, body: string[], width: number): string[] {
  const inner = width - 2;
  const titleStr = ` ${title} `;
  const top = `┌─${titleStr}${"─".repeat(Math.max(0, inner - visualWidth(titleStr) - 1))}┐`;
  const out = [top];
  for (const line of body) out.push(`│ ${padEnd(trimToWidth(line, inner - 2), inner - 2)} │`);
  out.push(`└${"─".repeat(inner)}┘`);
  return out;
}

// 이닝별 득점을 막대 스파크라인으로. 0=바닥 점, 1~=높이 증가.
const BAR_STEPS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
function inningBars(runs: string[], color: (s: string) => string): string {
  // 각 셀을 2폭으로 맞춰 위쪽 숫자 컬럼(padStart 2) 아래 정렬되게 한다.
  return runs
    .map((v) => {
      if (v === "" || v === "-") return "  ";
      const n = Number(v);
      const glyph =
        !Number.isFinite(n) || n <= 0
          ? pc.dim("▁")
          : color(BAR_STEPS[Math.min(n, BAR_STEPS.length - 1)]!);
      return padStart(glyph, 2);
    })
    .join(" ");
}

function timeStr(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

const NAME_COL = 10;

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

function labelValueRows(rows: [string, string | null | undefined][]): string[] {
  return rows
    .filter(([, v]) => v != null && v !== "")
    .map(([label, value]) => `  ${padEnd(pc.dim(label), NAME_COL)}  ${value}`);
}

function inningLineSection(
  game: NormalizedGame,
  ctx: RenderCtx,
  opts: { sparkline?: boolean; rheb?: { away: RHEB; home: RHEB } | null } = {}
): string[] {
  if (game.inningLine.away.length === 0) return [];
  const innings = game.inningLine.away.length;
  const sparkline = opts.sparkline ?? ctx.mode !== "compact";
  // compact 에선 4회 단위로 줄바꿈해 좁은 폭에서도 정렬 유지.
  const chunkSize = ctx.mode === "compact" ? 4 : innings;
  // 라이브 R/H/E/B 열 — 실제 전광판처럼 이닝 숫자 오른쪽에 붙인다 (compact 는 요약줄).
  const rhebCols = ctx.mode !== "compact" && opts.rheb ? opts.rheb : null;
  const rhebCells = (r: RHEB) => [r.r, r.h, r.e, r.b].map((n) => String(n).padStart(2)).join(" ");
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
    const rhebHead = rhebCols
      ? `   ${["R", "H", "E", "B"].map((c) => c.padStart(2)).join(" ")}`
      : "";
    const rhebAway = rhebCols ? pc.bold(`   ${rhebCells(rhebCols.away)}`) : "";
    const rhebHome = rhebCols ? pc.bold(`   ${rhebCells(rhebCols.home)}`) : "";
    out.push(`  ${pc.dim(padEnd("회", 6))} ${pc.dim(headerCells + rhebHead)}`);
    out.push(`  ${padEnd(game.awayTeamName, 6)} ${awaySlice}${rhebAway}`);
    out.push(`  ${padEnd(game.homeTeamName, 6)} ${homeSlice}${rhebHome}`);
    // 득점 스파크라인 — 숫자 표 아래 팀 컬러 막대로 흐름을 한눈에.
    if (sparkline) {
      const awayBar = inningBars(game.inningLine.away.slice(i, i + len), teamFg(game.awayTeamName));
      const homeBar = inningBars(game.inningLine.home.slice(i, i + len), teamFg(game.homeTeamName));
      out.push(`  ${padEnd("", 6)} ${awayBar}`);
      out.push(`  ${padEnd("", 6)} ${homeBar}`);
    }
    if (i + chunkSize < innings) out.push("");
  }
  // compact: 열을 붙일 폭이 없어 마지막에 한 줄 요약.
  if (ctx.mode === "compact" && opts.rheb) {
    const { away, home } = opts.rheb;
    out.push(pc.dim(`  H ${away.h}-${home.h}  E ${away.e}-${home.e}  B ${away.b}-${home.b}`));
  }
  return out;
}

// STARTED 라이브 R/H/E/B — 양쪽 다 있을 때만 이닝표에 병합.
function liveRheb(game: NormalizedGame): { away: RHEB; home: RHEB } | null {
  if (game.status !== "STARTED" || !game.awayRheb || !game.homeRheb) return null;
  return { away: game.awayRheb, home: game.homeRheb };
}

// 공격팀 타순 패널 (wide 우측 전용). 라인업 미발표면 빈 배열.
function lineupPanelLines(game: NormalizedGame, width: number): string[] {
  if (game.status !== "STARTED" || !game.lineups) return [];
  const side = game.topBottom === "top" ? "away" : "home";
  const slots = game.lineups[side];
  if (slots.length === 0) return [];
  const teamName = side === "away" ? game.awayTeamName : game.homeTeamName;
  const rows = lineupRows(slots, game.currentBatterPcode, teamFg(teamName), width - 4);
  return panel(`${teamName} 타순`, rows, width);
}

// 다이아몬드 + 스트라이크존 차트 결합 블록. 다이아몬드 우측 빈 공간에 차트를
// 나란히 붙여 세로 비용 없이 투구 위치를 보여준다. 차트가 없으면 다이아몬드만.
function fieldLines(game: NormalizedGame, ctx: RenderCtx, width: number): string[] {
  const field = diamondField(game.bases, ctx.anim);
  const zoneWidth = width - FIELD_DISPLAY_W - FIELD_ZONE_GAP;
  const zone =
    game.status === "STARTED" && zoneWidth >= 13
      ? strikeZoneChart(game.currentAtBatPitches, zoneWidth)
      : [];
  if (zone.length === 0) return field;
  // 차트(8줄)를 다이아몬드(12줄) 세로 중앙에 맞춘다.
  const padTop = Math.max(0, Math.floor((field.length - zone.length) / 2));
  const centered = [...Array.from({ length: padTop }, () => ""), ...zone];
  return joinColumns(field, centered, FIELD_DISPLAY_W, FIELD_ZONE_GAP);
}

// 승률 바 섹션 라인 (STARTED 전용). winRate 없으면 빈 배열.
function winRateLines(game: NormalizedGame, width: number): string[] {
  if (game.status !== "STARTED" || !game.winRate) return [];
  const bar = winRateBar(
    { name: game.awayTeamName, rate: game.winRate.away, color: teamFg(game.awayTeamName) },
    { name: game.homeTeamName, rate: game.winRate.home, color: teamFg(game.homeTeamName) },
    width
  );
  return bar ? [`  ${bar}`] : [];
}

interface RenderCtx {
  mode: LayoutMode;
  innerWidth: number;
  rightInner?: number;
  historyOffset: number;
  recentViewport: number; // 높이 무제한일 때의 기본(base) viewport
  bodyBudget: number; // 본문에 허용된 줄 수 (Infinity = 무제한)
  anim?: RenderAnim;
}

function recentSectionHeader(offset: number, viewport: number, total: number): string {
  if (offset <= 0) return pc.dim("  ─ 최근 플레이 ─");
  const remaining = Math.max(0, total - viewport - offset);
  return pc.dim(`  ─ 히스토리 ▲${remaining} ─`);
}

// 섹션 라인(첫 줄 "─ 타자 ─" 헤더)을 패널 본문으로 변환 — 헤더 제거 + 좌측 2칸 제거.
function toPanelBody(sectionLines: string[]): string[] {
  return sectionLines.slice(1).map((l) => l.replace(/^ {2}/, ""));
}

function recentPlayLines(
  game: NormalizedGame,
  ctx: RenderCtx,
  width: number,
  viewport: number
): string[] {
  if (game.recentPlays.length === 0) return [];
  const offset = ctx.historyOffset;
  const out = [recentSectionHeader(offset, viewport, game.recentPlays.length)];
  for (const p of game.recentPlays.slice(offset, offset + viewport)) {
    out.push(trimToWidth(`  ${pc.dim("▸")} ${p}`, width));
  }
  return out;
}

// 최근 플레이 flex 섹션 — 남는 세로 공간을 흡수한다.
function recentFlex(game: NormalizedGame, ctx: RenderCtx, width: number): FlexSection | null {
  if (game.recentPlays.length === 0) return null;
  const available = Math.max(0, game.recentPlays.length - ctx.historyOffset);
  return {
    min: Math.min(2, Math.max(1, available)),
    base: ctx.recentViewport,
    max: Math.max(1, available),
    render: (v) => ["", ...recentPlayLines(game, ctx, width, v)],
  };
}

type FittedBody = { lines: string[]; viewport: number };

function renderStartedBodyWide(
  game: NormalizedGame,
  ctx: RenderCtx,
  rightInner: number
): FittedBody {
  const leftSections: Section[] = [
    {
      id: "header",
      lines: [
        "",
        ...scoreHeaderBig(
          game.awayTeamName,
          game.homeTeamName,
          game.awayScore,
          game.homeScore,
          startedCenterLines(game),
          WIDE_LEFT_INNER,
          { flash: ctx.anim?.flash }
        ),
      ],
    },
    {
      id: "diamond",
      lines: [
        "",
        ...fieldLines(game, ctx, WIDE_LEFT_INNER),
        `  ${compactCountLine(game.ball, game.strike, game.out)}`,
      ],
      alt: [
        "",
        `  ${compactDiamond(game.bases)}`,
        `  ${compactCountLine(game.ball, game.strike, game.out)}`,
      ],
    },
    {
      id: "inning",
      lines: prefixGap(
        inningLineSection(game, { ...ctx, mode: "normal" }, { rheb: liveRheb(game) })
      ),
      alt: prefixGap(
        inningLineSection(
          game,
          { ...ctx, mode: "normal" },
          { sparkline: false, rheb: liveRheb(game) }
        )
      ),
    },
  ];
  // 승률 바는 전광판 바로 아래.
  leftSections.splice(1, 0, {
    id: "winrate",
    lines: prefixGap(winRateLines(game, WIDE_LEFT_INNER - 2)),
  });
  const rightSections: Section[] = [
    {
      id: "batter",
      lines: [
        "",
        ...panel("타자", toPanelBody(renderBatterSection(game.batterStats, false)), rightInner),
      ],
    },
    {
      id: "pitcher",
      lines: [
        "",
        ...panel("투수", toPanelBody(renderPitcherSection(game.pitcherStats, false)), rightInner),
      ],
    },
    { id: "lineup", lines: prefixGap(lineupPanelLines(game, rightInner)) },
    { id: "recent", lines: [] },
  ];
  const leftFit = fitBody(leftSections, ctx.bodyBudget, null, [
    "winrate",
    "diamond",
    "inning",
    "inning",
  ]);
  const rightFit = fitBody(rightSections, ctx.bodyBudget, recentFlex(game, ctx, rightInner), [
    "lineup",
    "batter",
    "pitcher",
  ]);
  return {
    lines: joinColumns(leftFit.lines, rightFit.lines, WIDE_LEFT_INNER),
    viewport: rightFit.viewport,
  };
}

// 섹션 앞에 구분 빈 줄. 내용이 없으면 빈 줄도 없이 통째로 사라진다.
function prefixGap(lines: string[]): string[] {
  return lines.length > 0 ? ["", ...lines] : [];
}

function renderStartedBody(game: NormalizedGame, ctx: RenderCtx): FittedBody {
  if (ctx.mode === "wide" && ctx.rightInner != null) {
    return renderStartedBodyWide(game, ctx, ctx.rightInner);
  }
  const compact = ctx.mode === "compact";
  const count = `  ${compactCountLine(game.ball, game.strike, game.out)}`;
  const compactHeader = scoreHeaderCompact(
    game.awayTeamName,
    game.homeTeamName,
    game.awayScore,
    game.homeScore,
    game.topBottom === "top" ? pc.cyan("  ◀") : "",
    game.topBottom === "bottom" ? pc.cyan("  ◀") : ""
  );

  const sections: Section[] = [];
  if (compact) {
    sections.push({ id: "header", lines: ["", ...compactHeader] });
    sections.push({ id: "diamond", lines: ["", `  ${compactDiamond(game.bases)}`, count] });
  } else {
    sections.push({
      id: "header",
      lines: [
        "",
        ...scoreHeaderBig(
          game.awayTeamName,
          game.homeTeamName,
          game.awayScore,
          game.homeScore,
          startedCenterLines(game),
          ctx.innerWidth - 2,
          { flash: ctx.anim?.flash }
        ),
      ],
      alt: ["", ...compactHeader],
    });
    sections.push({
      id: "diamond",
      lines: ["", ...fieldLines(game, ctx, ctx.innerWidth - 2), count],
      alt: ["", `  ${compactDiamond(game.bases)}`, count],
    });
  }
  if (compact) {
    sections.push({ id: "batter", lines: prefixGap(renderBatterSection(game.batterStats, true)) });
    sections.push({
      id: "pitcher",
      lines: prefixGap(renderPitcherSection(game.pitcherStats, true)),
    });
  } else {
    // 타자+투수 스택. 폭이 되면 우측에 타순 패널을 나란히 붙여 wide 와 정보량을
    // 맞춘다. 폭이 모자라면 타순은 아래 별도 섹션 (높이 부족 시 가장 먼저 강등).
    const bp = [
      ...renderBatterSection(game.batterStats, false),
      "",
      ...renderPitcherSection(game.pitcherStats, false),
    ];
    const bpAlt = [
      ...renderBatterSection(game.batterStats, true),
      "",
      ...renderPitcherSection(game.pitcherStats, true),
    ];
    const bpW = Math.max(...bp.map(visualWidth));
    const sideW = Math.min(44, ctx.innerWidth - 4 - bpW - 2);
    const sideLineup = sideW >= 32 ? lineupPanelLines(game, sideW) : [];
    sections.push({
      id: "players",
      lines: prefixGap(sideLineup.length > 0 ? joinColumns(bp, sideLineup, bpW) : bp),
      alt: prefixGap(bpAlt),
    });
    if (sideLineup.length === 0) {
      sections.push({
        id: "lineup",
        lines: prefixGap(lineupPanelLines(game, Math.min(44, ctx.innerWidth - 4))),
      });
    }
  }
  sections.push({
    id: "inning",
    lines: prefixGap(inningLineSection(game, ctx, { rheb: liveRheb(game) })),
    alt: compact
      ? undefined
      : prefixGap(inningLineSection(game, ctx, { sparkline: false, rheb: liveRheb(game) })),
  });
  sections.push({ id: "recent", lines: [] });

  // 승률 바 — 전광판 바로 아래 (compact 는 폭이 좁아 생략).
  if (!compact) {
    sections.splice(1, 0, {
      id: "winrate",
      lines: prefixGap(winRateLines(game, ctx.innerWidth - 4)),
    });
  }

  const degrade = compact
    ? ["batter", "pitcher", "inning"]
    : ["lineup", "inning", "players", "winrate", "diamond", "players", "inning", "header"];
  return fitBody(sections, ctx.bodyBudget, recentFlex(game, ctx, ctx.innerWidth - 4), degrade);
}

// RESULT 헤더용: 승/패/무 태그.
function resultTags(game: NormalizedGame): { awayTag?: string; homeTag?: string } {
  if (game.winner === "AWAY") return { awayTag: pc.yellow("★ 승"), homeTag: pc.dim("패") };
  if (game.winner === "HOME") return { awayTag: pc.dim("패"), homeTag: pc.yellow("★ 승") };
  if (game.winner === "DRAW") return { awayTag: pc.dim("무"), homeTag: pc.dim("무") };
  return {};
}
const RESULT_CENTER = ["", pc.bold("경기 종료"), "", ""];

function boxscoreLines(game: NormalizedGame): string[] {
  if (!game.homeRheb || !game.awayRheb) return [];
  const out = [pc.dim("  ─ 박스스코어 ─")];
  const head = ["R", "H", "E", "B"].map((c) => c.padStart(3)).join(" ");
  out.push(`  ${padEnd("", 6)} ${pc.dim(head)}`);
  const cells = (r: { r: number; h: number; e: number; b: number }) =>
    [r.r, r.h, r.e, r.b].map((n) => String(n).padStart(3)).join(" ");
  out.push(`  ${padEnd(game.awayTeamName, 6)} ${cells(game.awayRheb)}`);
  out.push(`  ${padEnd(game.homeTeamName, 6)} ${cells(game.homeRheb)}`);
  return out;
}

function resultMetaLines(game: NormalizedGame): string[] {
  const starterMatch =
    game.awayStarter || game.homeStarter
      ? `${game.awayStarter ?? "?"}  vs  ${game.homeStarter ?? "?"}`
      : null;
  const rows = labelValueRows([
    ["승리투수", game.winPitcher],
    ["패전투수", game.losePitcher],
    ["선발", starterMatch],
  ]);
  return rows.length > 0 ? [pc.dim("  ─ 결과 ─"), ...rows] : [];
}

// 하이라이트 flex 섹션 (RESULT). base 는 기존 상한(compact 3 / normal 5 / wide 10).
function highlightFlex(game: NormalizedGame, ctx: RenderCtx, width: number): FlexSection | null {
  const highlights = filterResultHighlights(game.recentPlays);
  if (highlights.length === 0) return null;
  const base = ctx.mode === "wide" ? 10 : ctx.mode === "compact" ? 3 : 5;
  return {
    min: Math.min(2, highlights.length),
    base,
    max: highlights.length,
    render: (v) => [
      "",
      pc.dim("  ─ 하이라이트 ─"),
      ...highlights.slice(0, v).map((p) => `  ${pc.dim("▸")} ${trimToWidth(p, width)}`),
    ],
  };
}

function renderResultBodyWide(
  game: NormalizedGame,
  ctx: RenderCtx,
  rightInner: number
): FittedBody {
  const leftSections: Section[] = [
    {
      id: "header",
      lines: [
        "",
        ...scoreHeaderBig(
          game.awayTeamName,
          game.homeTeamName,
          game.awayScore,
          game.homeScore,
          RESULT_CENTER,
          WIDE_LEFT_INNER,
          resultTags(game)
        ),
      ],
    },
    { id: "boxscore", lines: prefixGap(boxscoreLines(game)) },
    { id: "resultmeta", lines: prefixGap(resultMetaLines(game)) },
    {
      id: "inning",
      lines: prefixGap(inningLineSection(game, { ...ctx, mode: "normal" })),
      alt: prefixGap(inningLineSection(game, { ...ctx, mode: "normal" }, { sparkline: false })),
    },
  ];
  const rightSections: Section[] = [{ id: "recent", lines: [] }];
  const leftFit = fitBody(leftSections, ctx.bodyBudget, null, ["inning", "inning", "resultmeta"]);
  const rightFit = fitBody(
    rightSections,
    ctx.bodyBudget,
    highlightFlex(game, ctx, rightInner - 4),
    []
  );
  return {
    lines: joinColumns(leftFit.lines, rightFit.lines, WIDE_LEFT_INNER),
    viewport: rightFit.viewport,
  };
}

function renderResultBody(game: NormalizedGame, ctx: RenderCtx): FittedBody {
  if (ctx.mode === "wide" && ctx.rightInner != null) {
    return renderResultBodyWide(game, ctx, ctx.rightInner);
  }
  const compact = ctx.mode === "compact";
  const header = compact
    ? scoreHeaderCompact(
        game.awayTeamName,
        game.homeTeamName,
        game.awayScore,
        game.homeScore,
        game.winner === "AWAY" ? pc.yellow("  ★") : "",
        game.winner === "HOME" ? pc.yellow("  ★") : ""
      )
    : scoreHeaderBig(
        game.awayTeamName,
        game.homeTeamName,
        game.awayScore,
        game.homeScore,
        RESULT_CENTER,
        ctx.innerWidth - 2,
        resultTags(game)
      );
  const sections: Section[] = [
    {
      id: "header",
      lines: ["", ...header],
      alt: compact
        ? undefined
        : [
            "",
            ...scoreHeaderCompact(
              game.awayTeamName,
              game.homeTeamName,
              game.awayScore,
              game.homeScore
            ),
          ],
    },
    { id: "boxscore", lines: prefixGap(boxscoreLines(game)) },
    { id: "resultmeta", lines: prefixGap(resultMetaLines(game)) },
    {
      id: "inning",
      lines: prefixGap(inningLineSection(game, ctx)),
      alt: compact ? undefined : prefixGap(inningLineSection(game, ctx, { sparkline: false })),
    },
    { id: "recent", lines: [] },
  ];
  const degrade = compact
    ? ["inning", "resultmeta", "boxscore"]
    : ["inning", "resultmeta", "inning", "boxscore", "header"];
  return fitBody(sections, ctx.bodyBudget, highlightFlex(game, ctx, ctx.innerWidth - 6), degrade);
}

function readyInfoLines(game: NormalizedGame): string[] {
  return labelValueRows([
    ["시작", game.gameDateTime ? game.gameDateTime.slice(11, 16) : null],
    ["구장", game.stadium],
    ["날씨", game.weather],
    ["중계", game.broadChannel],
  ]);
}

// READY/BEFORE/CANCEL/SUSPENDED 가운데 열: 상태 + 시작 시각.
function readyCenterLines(game: NormalizedGame): string[] {
  const statusText =
    game.status === "CANCEL"
      ? pc.yellow("경기 취소")
      : game.status === "SUSPENDED"
        ? pc.yellow("경기 중단")
        : pc.cyan("경기 전");
  const time = game.gameDateTime ? game.gameDateTime.slice(11, 16) : "";
  return ["", statusText, time ? pc.dim(time) : "", ""];
}

function readyHeader(game: NormalizedGame, innerWidth: number, compact: boolean): string[] {
  if (compact) {
    return scoreHeaderCompact(game.awayTeamName, game.homeTeamName, game.awayScore, game.homeScore);
  }
  return scoreHeaderBig(
    game.awayTeamName,
    game.homeTeamName,
    game.awayScore,
    game.homeScore,
    readyCenterLines(game),
    innerWidth
  );
}

function renderReadyBody(game: NormalizedGame, ctx: RenderCtx): FittedBody {
  const infoLines = readyInfoLines(game);
  // wide 인데 우측 정보가 부족하면 normal 로 격하해 휑함을 피한다.
  if (ctx.mode === "wide" && ctx.rightInner != null && infoLines.length >= 3) {
    const left: string[] = [""];
    left.push(...readyHeader(game, WIDE_LEFT_INNER, false));
    left.push("");
    if (game.awayStarter || game.homeStarter) {
      left.push(pc.dim("  ─ 선발 ─"));
      left.push(`  ${padEnd(game.awayTeamName, 6)} ${game.awayStarter ?? pc.dim("미정")}`);
      left.push(`  ${padEnd(game.homeTeamName, 6)} ${game.homeStarter ?? pc.dim("미정")}`);
    }
    const right: string[] = [""];
    right.push(
      ...panel(
        "경기 정보",
        infoLines.map((l) => l.replace(/^ {2}/, "")),
        ctx.rightInner
      )
    );
    return { lines: joinColumns(left, right, WIDE_LEFT_INNER), viewport: 0 };
  }

  const starters: string[] =
    game.awayStarter || game.homeStarter
      ? [
          pc.dim("  ─ 선발 ─"),
          `  ${padEnd(game.awayTeamName, 6)} ${game.awayStarter ?? pc.dim("미정")}`,
          `  ${padEnd(game.homeTeamName, 6)} ${game.homeStarter ?? pc.dim("미정")}`,
        ]
      : [];
  const info = infoLines.length > 0 ? [pc.dim("  ─ 경기 정보 ─"), ...infoLines] : [];
  const sections: Section[] = [
    { id: "header", lines: ["", ...readyHeader(game, ctx.innerWidth - 2, ctx.mode === "compact")] },
    { id: "starters", lines: prefixGap(starters) },
    { id: "info", lines: prefixGap(info) },
  ];
  return fitBody(sections, ctx.bodyBudget, null, ["info", "starters"]);
}

const HEADER_LABEL: Record<GameStatus, (g: NormalizedGame) => string> = {
  // STARTED 의 이닝/아웃은 대형 헤더 가운데로 옮겼으므로 타이틀엔 LIVE 태그만.
  STARTED: () => pc.green("● LIVE"),
  RESULT: () => "경기 종료",
  READY: () => "경기 전",
  BEFORE: () => "경기 전",
  CANCEL: () => "경기 취소",
  SUSPENDED: () => "경기 중단",
};

const BODY_RENDERERS: Record<GameStatus, (g: NormalizedGame, ctx: RenderCtx) => FittedBody> = {
  STARTED: renderStartedBody,
  RESULT: renderResultBody,
  READY: renderReadyBody,
  BEFORE: renderReadyBody,
  CANCEL: renderReadyBody,
  SUSPENDED: renderReadyBody,
};

export function recentViewportForMode(mode: LayoutMode): number {
  if (mode === "wide") return 7;
  if (mode === "compact") return 3;
  return 5;
}

// LIVE 인디케이터. pulse(0..1) 가 오면 ● 밝기가 맥동, 정적 렌더면 기본 초록.
function livePulseTag(pulse?: number): string {
  if (pulse == null) return pc.green("● LIVE");
  const glyph = pulse > 0.5 ? pc.bold(pc.green("●")) : pc.dim(pc.green("●"));
  return `${glyph} ${pc.green("LIVE")}`;
}

export interface RenderGameOpts {
  staleSec?: number;
  multiGame?: boolean;
  layout?: LayoutMode | "auto";
  historyOffset?: number;
  anim?: RenderAnim;
  rows?: number; // 높이 강제 (fixture/테스트용) — 미지정 시 detectRows()
  others?: ScheduleGame[]; // 다른 경기들 — 있으면 푸터 위 티커 행으로
}

// watch 루프용: 프레임 문자열과 함께 실제 적용된 최근 플레이 viewport 를 돌려준다
// (히스토리 스크롤 클램프가 고정값이 아닌 실측 viewport 를 쓰도록).
export function renderGameFrame(
  game: NormalizedGame,
  opts: RenderGameOpts = {}
): { text: string; recentViewport: number } {
  const stale = opts.staleSec ?? 0;
  const cols = detectColumns();
  const mode = pickLayoutMode(cols, opts.layout);
  const innerWidth = frameWidthFor(mode, cols);
  const headerStatus =
    game.status === "STARTED" ? livePulseTag(opts.anim?.pulse) : HEADER_LABEL[game.status](game);
  const venue = game.stadium ? pc.dim(` · ${game.stadium}`) : "";
  const staleTag = stale > 0 ? pc.yellow(` ⚠ stale ${stale}s`) : "";
  const title = `KBO · ${headerStatus}${venue}${staleTag}`;

  const ticker = opts.others && opts.others.length > 0 ? tickerLine(opts.others) : undefined;

  // 본문 높이 예산: 프레임 4줄(상단/구분선/푸터/하단) + watch draw 의 말미 빈 줄 1
  // + 커서 여유 1 + 티커 2줄(구분선+행) 을 빼고 남는 줄. rows=0(비 TTY)이면 무제한.
  const rows = opts.rows ?? detectRows();
  const reserved = 6 + (ticker ? 2 : 0);
  const bodyBudget = rows > 0 ? Math.max(8, rows - reserved) : Number.POSITIVE_INFINITY;

  const ctx: RenderCtx = {
    mode,
    innerWidth,
    historyOffset: opts.historyOffset ?? 0,
    recentViewport: recentViewportForMode(mode),
    bodyBudget,
    anim: opts.anim,
  };
  if (mode === "wide") {
    // frame() 의 내용 폭 예산은 innerWidth-2 (좌우 "│ " … " │" 인셋). 우측 컬럼을
    // 꽉 채워 그리는 패널이 넘치지 않도록 2칸 보정한 buildable 폭을 넘긴다.
    ctx.rightInner = wideColumnWidths(innerWidth).right - 2;
  }
  const body = BODY_RENDERERS[game.status](game, ctx);

  const switchHint = opts.multiGame ? "  ←/→:경기전환" : "";
  const footer = `q:종료  r:새로고침${switchHint}  · ${timeStr(game.fetchedAt)}`;
  return {
    text: frame(title, body.lines, footer, innerWidth, ticker).join("\n"),
    recentViewport: body.viewport,
  };
}

export function renderGame(game: NormalizedGame, opts: RenderGameOpts = {}): string {
  return renderGameFrame(game, opts).text;
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
