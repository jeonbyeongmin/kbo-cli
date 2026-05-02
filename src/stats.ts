import pc from "picocolors";
import { currentSeasonCode, fetchLeaderboards, fetchPlayers, fetchStandings } from "./api.ts";
import {
  type LayoutMode,
  colorTeam,
  detectColumns,
  frame,
  frameWidthFor,
  onResize,
  padEnd,
  pickLayoutMode,
  truncName,
  visualWidth,
} from "./render.ts";
import type { PlayerRanking, TeamStat, TopPlayerCategory } from "./types.ts";

const ENTER_ALT = "\x1b[?1049h";
const EXIT_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const HOME = "\x1b[H";
const CLEAR_SCREEN = "\x1b[2J";
const CLEAR_AFTER = "\x1b[J";
const CLEAR_LINE = "\x1b[K";

const LEADERBOARD_WINDOW = 20;

type StatsView = "standings" | "batting" | "pitching";

interface StatsArgs {
  view: StatsView;
  debug: boolean;
  layout?: LayoutMode | "auto";
}

interface Column<T> {
  header: string;
  width: number;
  cell: (row: T, idx: number) => string;
}

interface ClippedColumns<T> {
  visible: Column<T>[];
  leftHidden: number;
  rightHidden: number;
}

// 컬럼 누적 폭이 innerWidth 를 넘으면 좌측에서 offset 만큼 빼고, 우측에서
// fit 까지만 노출한다. 잘린 양 끝은 ◂ / ▸ 인디케이터로 표시 (header/cell 측에서).
function clipColumns<T>(
  cols: Column<T>[],
  innerWidth: number,
  offset: number
): ClippedColumns<T> {
  const max = Math.max(0, Math.min(offset, cols.length));
  const after = cols.slice(max);
  const visible: Column<T>[] = [];
  // " " 좌측 패딩 1 + 컬럼 사이 " " 1.
  let used = 1;
  for (const c of after) {
    const next = used + c.width + (visible.length > 0 ? 1 : 0);
    if (next > innerWidth) break;
    visible.push(c);
    used = next;
  }
  return {
    visible,
    leftHidden: max,
    rightHidden: cols.length - max - visible.length,
  };
}

function renderTable<T>(rows: T[], cols: Column<T>[], startIdx = 0): string[] {
  const header = ` ${cols.map((c) => pc.dim(padEnd(c.header, c.width))).join(" ")}`;
  const lines = [header];
  rows.forEach((r, i) => {
    const idx = startIdx + i;
    lines.push(` ${cols.map((c) => padEnd(c.cell(r, idx), c.width)).join(" ")}`);
  });
  return lines;
}

function wrapLabels(parts: string[], innerWidth: number): string[] {
  const out: string[] = [];
  let line = "";
  let lineW = 0;
  for (const p of parts) {
    const w = visualWidth(p);
    if (line === "") {
      line = p;
      lineW = w;
      continue;
    }
    const candidate = lineW + 1 + w;
    if (candidate > innerWidth) {
      out.push(line);
      line = p;
      lineW = w;
    } else {
      line = `${line} ${p}`;
      lineW = candidate;
    }
  }
  if (line !== "") out.push(line);
  return out;
}

function fmtRate(n: number | null | undefined, decimals = 3): string {
  if (n == null || Number.isNaN(n)) return "-";
  const s = n.toFixed(decimals);
  return s.startsWith("0.") ? s.slice(1) : s;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "-";
  return String(n);
}

function fmtGB(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "-";
  if (n === 0) return "-";
  return n.toFixed(1);
}

function colorLastFive(s: string | undefined): string {
  if (!s) return "-";
  return s
    .split("")
    .map((ch) => {
      if (ch === "W") return pc.green(ch);
      if (ch === "L") return pc.red(ch);
      if (ch === "D" || ch === "T") return pc.yellow(ch);
      return ch;
    })
    .join("");
}

function colorStreak(s: string | undefined): string {
  if (!s) return "-";
  if (s.endsWith("승")) return pc.green(s);
  if (s.endsWith("패")) return pc.red(s);
  return pc.yellow(s);
}

function highlight(label: string, active: boolean): string {
  return active ? `${pc.cyan("▶")}${pc.bold(label)}${pc.cyan("◀")}` : pc.dim(label);
}

function styledKeyParts(labels: string[], activeIdx: number): string[] {
  return labels.map((l, i) => highlight(l, i === activeIdx));
}

interface SortKey<T> {
  label: string;
  apply: (rows: T[]) => T[];
}

function descBy<T>(get: (r: T) => number | null | undefined): (rs: T[]) => T[] {
  return (rs) =>
    [...rs].sort(
      (a, b) => (get(b) ?? Number.NEGATIVE_INFINITY) - (get(a) ?? Number.NEGATIVE_INFINITY)
    );
}

function ascBy<T>(get: (r: T) => number | null | undefined): (rs: T[]) => T[] {
  return (rs) =>
    [...rs].sort(
      (a, b) => (get(a) ?? Number.POSITIVE_INFINITY) - (get(b) ?? Number.POSITIVE_INFINITY)
    );
}

interface StandingsViewDef {
  label: string;
  columns: Column<TeamStat>[];
  sorts: SortKey<TeamStat>[];
}

const STANDINGS_VIEWS: StandingsViewDef[] = [
  {
    label: "기본",
    columns: [
      { header: "순", width: 4, cell: (r) => String(r.ranking) },
      { header: "팀", width: 6, cell: (r) => colorTeam(r.teamName) },
      { header: "경기", width: 6, cell: (r) => fmtNum(r.gameCount) },
      { header: "승", width: 4, cell: (r) => fmtNum(r.winGameCount) },
      { header: "패", width: 4, cell: (r) => fmtNum(r.loseGameCount) },
      { header: "무", width: 4, cell: (r) => fmtNum(r.drawnGameCount) },
      { header: "승률", width: 6, cell: (r) => fmtRate(r.wra) },
      { header: "게임차", width: 7, cell: (r) => fmtGB(r.gameBehind) },
      { header: "연속", width: 5, cell: (r) => colorStreak(r.continuousGameResult) },
      { header: "최근5", width: 8, cell: (r) => colorLastFive(r.lastFiveGames) },
    ],
    sorts: [
      { label: "순위", apply: (rs) => [...rs].sort((a, b) => a.ranking - b.ranking) },
      { label: "승", apply: descBy<TeamStat>((r) => r.winGameCount) },
      { label: "패", apply: ascBy<TeamStat>((r) => r.loseGameCount) },
      { label: "승률", apply: descBy<TeamStat>((r) => r.wra) },
    ],
  },
  {
    label: "공격",
    columns: [
      { header: "순", width: 4, cell: (r) => String(r.ranking) },
      { header: "팀", width: 6, cell: (r) => colorTeam(r.teamName) },
      { header: "경기", width: 5, cell: (r) => fmtNum(r.gameCount) },
      { header: "타율", width: 7, cell: (r) => fmtRate(r.offenseHra) },
      { header: "출루율", width: 6, cell: (r) => fmtRate(r.offenseObp) },
      { header: "장타율", width: 6, cell: (r) => fmtRate(r.offenseSlg) },
      { header: "OPS", width: 6, cell: (r) => fmtRate(r.offenseOps) },
      { header: "HR", width: 4, cell: (r) => fmtNum(r.offenseHr) },
      { header: "타점", width: 5, cell: (r) => fmtNum(r.offenseRbi) },
      { header: "도루", width: 5, cell: (r) => fmtNum(r.offenseSb) },
    ],
    sorts: [
      { label: "타율", apply: descBy<TeamStat>((r) => r.offenseHra) },
      { label: "OPS", apply: descBy<TeamStat>((r) => r.offenseOps) },
      { label: "출루율", apply: descBy<TeamStat>((r) => r.offenseObp) },
      { label: "장타율", apply: descBy<TeamStat>((r) => r.offenseSlg) },
      { label: "HR", apply: descBy<TeamStat>((r) => r.offenseHr) },
      { label: "타점", apply: descBy<TeamStat>((r) => r.offenseRbi) },
      { label: "도루", apply: descBy<TeamStat>((r) => r.offenseSb) },
    ],
  },
  {
    label: "수비",
    columns: [
      { header: "순", width: 4, cell: (r) => String(r.ranking) },
      { header: "팀", width: 6, cell: (r) => colorTeam(r.teamName) },
      { header: "ERA", width: 7, cell: (r) => fmtRate(r.defenseEra, 2) },
      { header: "WHIP", width: 6, cell: (r) => fmtRate(r.defenseWhip, 2) },
      { header: "이닝", width: 7, cell: (r) => fmtNum(r.defenseInning) },
      { header: "K", width: 5, cell: (r) => fmtNum(r.defenseKk) },
      { header: "QS", width: 4, cell: (r) => fmtNum(r.defenseQs) },
      { header: "SAVE", width: 5, cell: (r) => fmtNum(r.defenseSave) },
      { header: "HOLD", width: 5, cell: (r) => fmtNum(r.defenseHold) },
      { header: "실책", width: 5, cell: (r) => fmtNum(r.defenseErr) },
    ],
    sorts: [
      { label: "ERA", apply: ascBy<TeamStat>((r) => r.defenseEra) },
      { label: "WHIP", apply: ascBy<TeamStat>((r) => r.defenseWhip) },
      { label: "K", apply: descBy<TeamStat>((r) => r.defenseKk) },
      { label: "SAVE", apply: descBy<TeamStat>((r) => r.defenseSave) },
      { label: "HOLD", apply: descBy<TeamStat>((r) => r.defenseHold) },
      { label: "실책", apply: ascBy<TeamStat>((r) => r.defenseErr) },
    ],
  },
];

const CATEGORY_LABEL: Record<string, string> = {
  hitterHra: "타율",
  hitterHr: "홈런",
  hitterRbi: "타점",
  hitterRun: "득점",
  hitterHit: "안타",
  hitterH2: "2루타",
  hitterH3: "3루타",
  hitterSb: "도루",
  hitterBb: "볼넷",
  hitterKk: "삼진",
  hitterOps: "OPS",
  hitterObp: "출루율",
  hitterSlg: "장타율",
  hitterIsop: "ISOP",
  hitterWar: "WAR",
  pitcherEra: "평균자책",
  pitcherWin: "다승",
  pitcherLose: "패",
  pitcherKk: "탈삼진",
  pitcherSave: "세이브",
  pitcherHold: "홀드",
  pitcherWhip: "WHIP",
  pitcherWar: "WAR",
};

function categoryLabel(type: string): string {
  return CATEGORY_LABEL[type] ?? type;
}

// 낮을수록 좋은 지표는 ASC, 그 외는 DESC.
function directionFor(type: string): "ASC" | "DESC" {
  return type === "pitcherEra" || type === "pitcherWhip" || type === "pitcherLose" ? "ASC" : "DESC";
}

function readMetric(row: PlayerRanking, type: string): number | null | undefined {
  return (row as unknown as Record<string, number | null | undefined>)[type];
}

// teamCode 모드 응답은 field 를 무시하고 리그 rank 순으로 내려와서 클라이언트에서 다시 정렬한다.
function sortPlayerRows(rows: PlayerRanking[], type: string): PlayerRanking[] {
  const factor = directionFor(type) === "ASC" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = readMetric(a, type);
    const vb = readMetric(b, type);
    const aMissing = va == null || Number.isNaN(va);
    const bMissing = vb == null || Number.isNaN(vb);
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return (va - vb) * factor;
  });
}

function hitterMetric(row: PlayerRanking, type: string): string {
  const v = readMetric(row, type);
  switch (type) {
    case "hitterHra":
    case "hitterObp":
    case "hitterSlg":
    case "hitterOps":
    case "hitterIsop":
      return fmtRate(v);
    case "hitterWar":
      return fmtRate(v, 2);
    default:
      return fmtNum(v);
  }
}

function pitcherMetric(row: PlayerRanking, type: string): string {
  switch (type) {
    case "pitcherEra":
    case "pitcherWhip":
    case "pitcherWar":
      return fmtRate(readMetric(row, type), 2);
    case "pitcherInning":
      return row.pitcherInning == null ? "-" : String(row.pitcherInning);
    default:
      return fmtNum(readMetric(row, type));
  }
}

// 팀 모드에선 응답이 리그 rank 순이 아니라 (이미 client 에서 재정렬됨) 순서가
// 카테고리별로 매번 달라지므로 표시 rank 도 1..N 시퀀스로 다시 매긴다.
function rankCell(useSequentialRank: boolean) {
  return (r: PlayerRanking, i: number) =>
    useSequentialRank ? String(i + 1) : String(r.ranking ?? "-");
}

function hitterColumns(
  activeType: string,
  activeLabel: string,
  useSequentialRank: boolean
): Column<PlayerRanking>[] {
  return [
    { header: "순", width: 4, cell: rankCell(useSequentialRank) },
    { header: "선수", width: 12, cell: (r) => truncName(r.playerName) },
    { header: "팀", width: 6, cell: (r) => colorTeam(r.teamShortName ?? r.teamName) },
    { header: activeLabel, width: 8, cell: (r) => pc.bold(hitterMetric(r, activeType)) },
    { header: "타수", width: 5, cell: (r) => fmtNum(r.hitterAb) },
    { header: "안타", width: 5, cell: (r) => fmtNum(r.hitterHit) },
    { header: "HR", width: 4, cell: (r) => fmtNum(r.hitterHr) },
    { header: "타점", width: 5, cell: (r) => fmtNum(r.hitterRbi) },
    { header: "OPS", width: 6, cell: (r) => fmtRate(r.hitterOps) },
  ];
}

function pitcherColumns(
  activeType: string,
  activeLabel: string,
  useSequentialRank: boolean
): Column<PlayerRanking>[] {
  return [
    { header: "순", width: 4, cell: rankCell(useSequentialRank) },
    { header: "선수", width: 12, cell: (r) => truncName(r.playerName) },
    { header: "팀", width: 6, cell: (r) => colorTeam(r.teamShortName ?? r.teamName) },
    { header: activeLabel, width: 8, cell: (r) => pc.bold(pitcherMetric(r, activeType)) },
    {
      header: "승-패",
      width: 7,
      cell: (r) => `${fmtNum(r.pitcherWin)}-${fmtNum(r.pitcherLose)}`,
    },
    {
      header: "이닝",
      width: 8,
      cell: (r) => (r.pitcherInning == null ? "-" : String(r.pitcherInning)),
    },
    { header: "K", width: 4, cell: (r) => fmtNum(r.pitcherKk) },
    { header: "WHIP", width: 6, cell: (r) => fmtRate(r.pitcherWhip, 2) },
  ];
}

function pushClipIndicator(body: string[], leftHidden: number, rightHidden: number): void {
  if (leftHidden === 0 && rightHidden === 0) return;
  const parts: string[] = [];
  if (leftHidden > 0) parts.push(pc.dim(`◂ ${leftHidden}컬럼`));
  if (rightHidden > 0) parts.push(pc.dim(`${rightHidden}컬럼 ▸`));
  body.push(` ${parts.join("   ")}`);
}

function pushLabelLine(body: string[], prefix: string, parts: string[], innerWidth: number): void {
  const indent = " ".repeat(visualWidth(prefix));
  const wrapped = wrapLabels(parts, Math.max(8, innerWidth - visualWidth(prefix) - 1));
  if (wrapped.length === 0) {
    body.push(prefix);
    return;
  }
  body.push(`${prefix} ${wrapped[0]}`);
  for (const ln of wrapped.slice(1)) body.push(`${indent} ${ln}`);
}

function renderStandings(state: StandingsState): string {
  const view = STANDINGS_VIEWS[state.viewIdx]!;
  const sort = view.sorts[state.sortIdx]!;
  const sorted = sort.apply(state.rows);

  const innerWidth = frameWidthFor(state.mode, state.cols);
  const clip = clipColumns(view.columns, innerWidth - 2, state.colOffset);

  const body = renderTable(sorted, clip.visible);
  pushClipIndicator(body, clip.leftHidden, clip.rightHidden);
  body.push("");
  pushLabelLine(
    body,
    pc.dim("뷰  :"),
    styledKeyParts(
      STANDINGS_VIEWS.map((v) => v.label),
      state.viewIdx
    ),
    innerWidth
  );
  pushLabelLine(
    body,
    pc.dim("정렬:"),
    styledKeyParts(
      view.sorts.map((s) => s.label),
      state.sortIdx
    ),
    innerWidth
  );

  const title = `KBO 순위 · ${view.label} · ${state.season}`;
  const footer = "←/→: 정렬  ↑/↓: 뷰  h/l: 가로  r: 새로고침  q: 종료";
  return frame(title, body, footer, innerWidth).join("\n");
}

interface TeamRef {
  code: string;
  name: string;
}

function renderLeaderboard(state: LeaderboardState): string {
  const cat = state.cats[state.catIdx]!;
  const activeLabel = categoryLabel(cat.type);
  const rows = currentLeaderboardRows(state);
  const window = rows.slice(state.offset, state.offset + LEADERBOARD_WINDOW);
  const useSequentialRank = state.teamCode != null;

  const innerWidth = frameWidthFor(state.mode, state.cols);
  const cols =
    state.playerType === "HITTER"
      ? hitterColumns(cat.type, activeLabel, useSequentialRank)
      : pitcherColumns(cat.type, activeLabel, useSequentialRank);
  const clip = clipColumns(cols, innerWidth - 2, state.colOffset);
  const body = renderTable(window, clip.visible, state.offset);
  pushClipIndicator(body, clip.leftHidden, clip.rightHidden);

  body.push("");
  pushLabelLine(
    body,
    pc.dim("카테고리:"),
    styledKeyParts(
      state.cats.map((c) => categoryLabel(c.type)),
      state.catIdx
    ),
    innerWidth
  );

  const teamLabels = ["전체", ...state.teams.map((t) => t.name)];
  const teamIdx = state.teamCode ? 1 + state.teams.findIndex((t) => t.code === state.teamCode) : 0;
  pushLabelLine(
    body,
    pc.dim("팀  :"),
    styledKeyParts(teamLabels, Math.max(0, teamIdx)),
    innerWidth
  );

  const total = rows.length;
  const from = total === 0 ? 0 : state.offset + 1;
  const to = Math.min(state.offset + LEADERBOARD_WINDOW, total);
  const rangeText = total === 0 ? "0 / 0" : `${from}-${to} / ${total}`;
  const teamSuffix = state.teamCode
    ? ` · ${state.teams.find((t) => t.code === state.teamCode)?.name ?? state.teamCode}`
    : "";
  const title = `${state.playerType === "HITTER" ? "타자" : "투수"} · ${activeLabel}${teamSuffix} · ${state.season}`;
  const footer = `${rangeText}  ←/→: 카테고리  ↑/↓: 스크롤  h/l: 가로  t: 팀  r/q`;
  return frame(title, body, footer, innerWidth).join("\n");
}

function currentLeaderboardRows(state: LeaderboardState): PlayerRanking[] {
  if (!state.teamCode) return state.cats[state.catIdx]?.rankings ?? [];
  const type = state.cats[state.catIdx]?.type;
  return type ? sortPlayerRows(state.teamRows, type) : state.teamRows;
}

interface StandingsState {
  kind: "standings";
  season: string;
  rows: TeamStat[];
  sortIdx: number;
  viewIdx: number;
  mode: LayoutMode;
  cols: number;
  colOffset: number;
}

interface LeaderboardState {
  kind: "leaderboard";
  season: string;
  playerType: "HITTER" | "PITCHER";
  cats: TopPlayerCategory[];
  catIdx: number;
  offset: number;
  teams: TeamRef[];
  teamCode: string | null;
  teamRows: PlayerRanking[];
  mode: LayoutMode;
  cols: number;
  colOffset: number;
}

type TuiState = StandingsState | LeaderboardState;

function renderState(state: TuiState): string {
  return state.kind === "standings" ? renderStandings(state) : renderLeaderboard(state);
}

function teamsFromStandings(rows: TeamStat[]): TeamRef[] {
  return rows.map((r) => ({ code: r.teamId, name: r.teamShortName ?? r.teamName }));
}

export async function cmdStats(args: StatsArgs): Promise<void> {
  const season = currentSeasonCode();
  const cols = detectColumns();
  const mode = pickLayoutMode(cols, args.layout);

  if (args.view === "standings") {
    const rows = await fetchStandings(season);
    if (args.debug) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log(pc.yellow(`${season} 시즌 순위 데이터가 비어 있습니다.`));
      return;
    }
    await runTui({
      kind: "standings",
      season,
      rows,
      sortIdx: 0,
      viewIdx: 0,
      mode,
      cols,
      colOffset: 0,
    });
    return;
  }

  const playerType = args.view === "batting" ? "HITTER" : "PITCHER";
  const [standings, leaderCats] = await Promise.all([
    fetchStandings(season),
    fetchLeaderboards(season, playerType),
  ]);
  if (args.debug) {
    console.log(JSON.stringify(leaderCats, null, 2));
    return;
  }
  if (leaderCats.length === 0) {
    console.log(pc.yellow(`${season} 시즌 ${playerType} 리더보드가 비어 있습니다.`));
    return;
  }
  await runTui({
    kind: "leaderboard",
    season,
    playerType,
    cats: leaderCats,
    catIdx: 0,
    offset: 0,
    teams: teamsFromStandings(standings),
    teamCode: null,
    teamRows: [],
    mode,
    cols,
    colOffset: 0,
  });
}

async function runTui(initial: TuiState): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log(renderState(initial));
    return;
  }

  let state: TuiState = initial;
  let stopped = false;
  let busy = false;
  let lastError: string | null = null;
  let offResize: (() => void) | null = null;

  const cleanup = () => {
    if (offResize) offResize();
    if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(SHOW_CURSOR + EXIT_ALT);
  };

  const exitClean = () => {
    if (stopped) return;
    stopped = true;
    cleanup();
    process.exit(0);
  };

  process.on("SIGINT", exitClean);
  process.on("SIGTERM", exitClean);
  process.on("uncaughtException", (err) => {
    cleanup();
    console.error("\n에러 발생:", err);
    process.exit(1);
  });

  process.stdout.write(ENTER_ALT + HIDE_CURSOR);

  const draw = () => {
    if (stopped) return;
    const body = lastError ? `\n  ${pc.red(lastError)}\n` : renderState(state);
    const out = `${body}\n`;
    process.stdout.write(HOME);
    for (const line of out.split("\n")) {
      process.stdout.write(`${CLEAR_LINE + line}\n`);
    }
    process.stdout.write(CLEAR_AFTER);
  };

  const clampOffset = (s: LeaderboardState): LeaderboardState => {
    const total = currentLeaderboardRows(s).length;
    const max = Math.max(0, total - LEADERBOARD_WINDOW);
    return { ...s, offset: Math.max(0, Math.min(s.offset, max)) };
  };

  // 팀 모드는 응답이 카테고리에 무관하게 동일하므로 한 번만 받아 캐시하고
  // 카테고리 전환은 client-side 정렬로 처리한다 — 중복 fetch 와 race 회피.
  const fetchTeamRows = async (s: LeaderboardState): Promise<PlayerRanking[]> => {
    if (!s.teamCode) return [];
    const type = s.cats[s.catIdx]?.type ?? "hitterHra";
    return fetchPlayers(s.season, {
      playerType: s.playerType,
      field: type,
      direction: directionFor(type),
      teamCode: s.teamCode,
    });
  };

  const cycleHorizontal = (delta: number) => {
    if (state.kind === "standings") {
      const len = STANDINGS_VIEWS[state.viewIdx]!.sorts.length;
      state = { ...state, sortIdx: (state.sortIdx + delta + len) % len };
      draw();
      return;
    }
    const len = state.cats.length;
    state = clampOffset({
      ...state,
      catIdx: (state.catIdx + delta + len) % len,
      offset: 0,
    });
    draw();
  };

  const cycleVertical = async (delta: number) => {
    if (state.kind === "standings") {
      const len = STANDINGS_VIEWS.length;
      state = {
        ...state,
        viewIdx: (state.viewIdx + delta + len) % len,
        sortIdx: 0,
      };
      draw();
      return;
    }
    state = clampOffset({ ...state, offset: state.offset + delta });
    draw();
  };

  const cycleTeam = async () => {
    if (state.kind !== "leaderboard") return;
    const lb = state;
    const cycle: (string | null)[] = [null, ...lb.teams.map((t) => t.code)];
    const cur = cycle.findIndex((c) => c === lb.teamCode);
    const nextCode = cycle[(cur + 1) % cycle.length] ?? null;
    const next: LeaderboardState = {
      ...lb,
      teamCode: nextCode,
      offset: 0,
      teamRows: [],
    };
    state = next;
    draw();
    if (nextCode) {
      busy = true;
      try {
        const rows = await fetchTeamRows(next);
        if (state.kind === "leaderboard" && state.teamCode === nextCode) {
          state = clampOffset({ ...state, teamRows: rows });
          lastError = null;
        }
      } catch (e) {
        lastError = `팀 데이터 로드 실패: ${(e as Error).message}`;
      } finally {
        busy = false;
        draw();
      }
    }
  };

  const refresh = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      if (state.kind === "standings") {
        const rows = await fetchStandings(state.season);
        if (rows.length > 0) state = { ...state, rows };
      } else if (state.teamCode) {
        const rows = await fetchTeamRows(state);
        state = clampOffset({ ...state, teamRows: rows });
      } else {
        const cats = await fetchLeaderboards(state.season, state.playerType);
        if (cats.length > 0) {
          const catIdx = Math.min(state.catIdx, cats.length - 1);
          state = clampOffset({ ...state, cats, catIdx });
        }
      }
      lastError = null;
    } catch (e) {
      lastError = `새로고침 실패: ${(e as Error).message}`;
    } finally {
      busy = false;
      draw();
    }
  };

  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (data: string) => {
      if (data === "q" || data === "Q" || data === "\x03") {
        exitClean();
        return;
      }
      if (data === "r" || data === "R") {
        void refresh();
        return;
      }
      if (data === "t" || data === "T") {
        void cycleTeam();
        return;
      }
      if (data === "h" || data === "H") {
        state = { ...state, colOffset: Math.max(0, state.colOffset - 1) };
        draw();
        return;
      }
      if (data === "l" || data === "L") {
        state = { ...state, colOffset: state.colOffset + 1 };
        draw();
        return;
      }
      if (data === "\x1b[C") {
        void cycleHorizontal(1);
        return;
      }
      if (data === "\x1b[D") {
        void cycleHorizontal(-1);
        return;
      }
      if (data === "\x1b[A") {
        void cycleVertical(-1);
        return;
      }
      if (data === "\x1b[B") {
        void cycleVertical(1);
        return;
      }
    });
  }

  // 리사이즈 시 cols 를 새로 측정하고 colOffset 을 0 으로 리셋해, 좁아져서
  // 잘렸다 다시 넓어졌을 때 시프트 상태가 어색해지는 것을 방지한다.
  offResize = onResize(() => {
    if (stopped) return;
    process.stdout.write(CLEAR_SCREEN);
    state = { ...state, cols: detectColumns(), colOffset: 0 };
    draw();
  });

  draw();
  await new Promise<void>(() => {});
}
