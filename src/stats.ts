import pc from "picocolors";
import { currentSeasonCode, fetchLeaderboards, fetchStandings } from "./api.ts";
import { colorTeam, frame, padEnd, truncName } from "./render.ts";
import type { PlayerRanking, TeamStat, TopPlayerCategory } from "./types.ts";

const ENTER_ALT = "\x1b[?1049h";
const EXIT_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const HOME = "\x1b[H";
const CLEAR_AFTER = "\x1b[J";
const CLEAR_LINE = "\x1b[K";

const INNER = 64;
const LEADERBOARD_LIMIT = 20;

type StatsView = "standings" | "batting" | "pitching";

interface StatsArgs {
  view: StatsView;
  debug: boolean;
}

interface SortKey {
  label: string;
  apply: (rows: TeamStat[]) => TeamStat[];
}

const STANDINGS_SORTS: SortKey[] = [
  {
    label: "순위",
    apply: (rs) => [...rs].sort((a, b) => a.ranking - b.ranking),
  },
  {
    label: "승",
    apply: (rs) => [...rs].sort((a, b) => (b.winGameCount ?? -1) - (a.winGameCount ?? -1)),
  },
  {
    label: "패",
    apply: (rs) =>
      [...rs].sort(
        (a, b) =>
          (a.loseGameCount ?? Number.POSITIVE_INFINITY) -
          (b.loseGameCount ?? Number.POSITIVE_INFINITY)
      ),
  },
  {
    label: "승률",
    apply: (rs) => [...rs].sort((a, b) => (b.wra ?? -1) - (a.wra ?? -1)),
  },
  {
    label: "타율",
    apply: (rs) => [...rs].sort((a, b) => (b.offenseHra ?? -1) - (a.offenseHra ?? -1)),
  },
  {
    label: "평균자책",
    apply: (rs) =>
      [...rs].sort(
        (a, b) =>
          (a.defenseEra ?? Number.POSITIVE_INFINITY) - (b.defenseEra ?? Number.POSITIVE_INFINITY)
      ),
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

function joinSortKeys(labels: string[], activeIdx: number): string {
  return labels.map((l, i) => highlight(l, i === activeIdx)).join(" ");
}

function renderStandings(rows: TeamStat[], sortIdx: number, season: string): string {
  const sort = STANDINGS_SORTS[sortIdx]!;
  const sorted = sort.apply(rows);
  const body: string[] = [];

  const header = ` ${[
    pc.dim(padEnd("순", 4)),
    pc.dim(padEnd("팀", 6)),
    pc.dim(padEnd("경기", 6)),
    pc.dim(padEnd("승", 4)),
    pc.dim(padEnd("패", 4)),
    pc.dim(padEnd("무", 4)),
    pc.dim(padEnd("승률", 6)),
    pc.dim(padEnd("게임차", 7)),
    pc.dim(padEnd("연속", 5)),
    pc.dim(padEnd("최근5", 8)),
  ].join(" ")}`;
  body.push(header);

  for (const r of sorted) {
    const line = ` ${[
      padEnd(String(r.ranking), 4),
      padEnd(colorTeam(r.teamName), 6),
      padEnd(fmtNum(r.gameCount), 6),
      padEnd(fmtNum(r.winGameCount), 4),
      padEnd(fmtNum(r.loseGameCount), 4),
      padEnd(fmtNum(r.drawnGameCount), 4),
      padEnd(fmtRate(r.wra), 6),
      padEnd(fmtGB(r.gameBehind), 7),
      padEnd(colorStreak(r.continuousGameResult), 5),
      padEnd(colorLastFive(r.lastFiveGames), 8),
    ].join(" ")}`;
    body.push(line);
  }

  body.push("");
  body.push(
    `${pc.dim("정렬:")} ${joinSortKeys(
      STANDINGS_SORTS.map((s) => s.label),
      sortIdx
    )}`
  );

  const title = `KBO 순위 · ${season}`;
  const footer = "←/→: 정렬 변경  r: 새로고침  q: 종료";
  return frame(title, body, footer, INNER).join("\n");
}

function hitterMetric(row: PlayerRanking, type: string): string {
  switch (type) {
    case "hitterHra":
    case "hitterObp":
    case "hitterSlg":
    case "hitterOps":
    case "hitterIsop":
      return fmtRate(row[type] as number | null | undefined);
    case "hitterWar":
      return fmtRate(row[type] as number | null | undefined, 2);
    default:
      return fmtNum(row[type] as number | null | undefined);
  }
}

function pitcherMetric(row: PlayerRanking, type: string): string {
  switch (type) {
    case "pitcherEra":
    case "pitcherWhip":
    case "pitcherWar":
      return fmtRate(row[type] as number | null | undefined, 2);
    case "pitcherInning": {
      const v = row.pitcherInning;
      return v == null ? "-" : String(v);
    }
    default:
      return fmtNum(row[type] as number | null | undefined);
  }
}

function renderHitterLeaderboard(
  cat: TopPlayerCategory,
  catIdx: number,
  cats: TopPlayerCategory[],
  season: string
): string {
  const body: string[] = [];
  const headlineLabel = categoryLabel(cat.type);

  const header = ` ${[
    pc.dim(padEnd("순", 4)),
    pc.dim(padEnd("선수", 12)),
    pc.dim(padEnd("팀", 6)),
    pc.dim(padEnd(headlineLabel, 8)),
    pc.dim(padEnd("타수", 5)),
    pc.dim(padEnd("안타", 5)),
    pc.dim(padEnd("HR", 4)),
    pc.dim(padEnd("타점", 5)),
    pc.dim(padEnd("OPS", 6)),
  ].join(" ")}`;
  body.push(header);

  for (const row of cat.rankings.slice(0, LEADERBOARD_LIMIT)) {
    const line = ` ${[
      padEnd(String(row.ranking), 4),
      padEnd(truncName(row.playerName), 12),
      padEnd(colorTeam(row.teamShortName ?? row.teamName), 6),
      padEnd(pc.bold(hitterMetric(row, cat.type)), 8),
      padEnd(fmtNum(row.hitterAb), 5),
      padEnd(fmtNum(row.hitterHit), 5),
      padEnd(fmtNum(row.hitterHr), 4),
      padEnd(fmtNum(row.hitterRbi), 5),
      padEnd(fmtRate(row.hitterOps), 6),
    ].join(" ")}`;
    body.push(line);
  }

  body.push("");
  body.push(
    `${pc.dim("카테고리:")} ${joinSortKeys(
      cats.map((c) => categoryLabel(c.type)),
      catIdx
    )}`
  );

  const title = `타자 · ${headlineLabel} · ${season}`;
  const footer = "←/→: 카테고리 전환  r: 새로고침  q: 종료";
  return frame(title, body, footer, INNER).join("\n");
}

function renderPitcherLeaderboard(
  cat: TopPlayerCategory,
  catIdx: number,
  cats: TopPlayerCategory[],
  season: string
): string {
  const body: string[] = [];
  const headlineLabel = categoryLabel(cat.type);

  const header = ` ${[
    pc.dim(padEnd("순", 4)),
    pc.dim(padEnd("선수", 12)),
    pc.dim(padEnd("팀", 6)),
    pc.dim(padEnd(headlineLabel, 8)),
    pc.dim(padEnd("승-패", 7)),
    pc.dim(padEnd("이닝", 8)),
    pc.dim(padEnd("K", 4)),
    pc.dim(padEnd("WHIP", 6)),
  ].join(" ")}`;
  body.push(header);

  for (const row of cat.rankings.slice(0, LEADERBOARD_LIMIT)) {
    const wl = `${fmtNum(row.pitcherWin)}-${fmtNum(row.pitcherLose)}`;
    const line = ` ${[
      padEnd(String(row.ranking), 4),
      padEnd(truncName(row.playerName), 12),
      padEnd(colorTeam(row.teamShortName ?? row.teamName), 6),
      padEnd(pc.bold(pitcherMetric(row, cat.type)), 8),
      padEnd(wl, 7),
      padEnd(row.pitcherInning == null ? "-" : String(row.pitcherInning), 8),
      padEnd(fmtNum(row.pitcherKk), 4),
      padEnd(fmtRate(row.pitcherWhip, 2), 6),
    ].join(" ")}`;
    body.push(line);
  }

  body.push("");
  body.push(
    `${pc.dim("카테고리:")} ${joinSortKeys(
      cats.map((c) => categoryLabel(c.type)),
      catIdx
    )}`
  );

  const title = `투수 · ${headlineLabel} · ${season}`;
  const footer = "←/→: 카테고리 전환  r: 새로고침  q: 종료";
  return frame(title, body, footer, INNER).join("\n");
}

export async function cmdStats(args: StatsArgs): Promise<void> {
  const season = await currentSeasonCode();

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
    });
    return;
  }

  const playerType = args.view === "batting" ? "HITTER" : "PITCHER";
  const cats = await fetchLeaderboards(season, playerType);
  if (args.debug) {
    console.log(JSON.stringify(cats, null, 2));
    return;
  }
  if (cats.length === 0) {
    console.log(pc.yellow(`${season} 시즌 ${playerType} 리더보드가 비어 있습니다.`));
    return;
  }
  await runTui({
    kind: "leaderboard",
    season,
    playerType,
    cats,
    catIdx: 0,
  });
}

type TuiState =
  | { kind: "standings"; season: string; rows: TeamStat[]; sortIdx: number }
  | {
      kind: "leaderboard";
      season: string;
      playerType: "HITTER" | "PITCHER";
      cats: TopPlayerCategory[];
      catIdx: number;
    };

function renderState(state: TuiState): string {
  if (state.kind === "standings") {
    return renderStandings(state.rows, state.sortIdx, state.season);
  }
  const cat = state.cats[state.catIdx]!;
  return state.playerType === "HITTER"
    ? renderHitterLeaderboard(cat, state.catIdx, state.cats, state.season)
    : renderPitcherLeaderboard(cat, state.catIdx, state.cats, state.season);
}

async function runTui(initial: TuiState): Promise<void> {
  // 비대화형 환경(파이프·리다이렉트)에선 alt-screen·키 입력이 의미 없으니
  // 한 프레임만 출력하고 종료한다.
  if (!process.stdin.isTTY) {
    console.log(renderState(initial));
    return;
  }

  let state: TuiState = initial;
  let stopped = false;
  let busy = false;
  let lastError: string | null = null;

  const cleanup = () => {
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

  const cycle = (delta: number) => {
    if (state.kind === "standings") {
      const len = STANDINGS_SORTS.length;
      state = { ...state, sortIdx: (state.sortIdx + delta + len) % len };
    } else {
      const len = state.cats.length;
      state = { ...state, catIdx: (state.catIdx + delta + len) % len };
    }
    draw();
  };

  const refresh = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      if (state.kind === "standings") {
        const rows = await fetchStandings(state.season);
        if (rows.length > 0) state = { ...state, rows };
      } else {
        const cats = await fetchLeaderboards(state.season, state.playerType);
        if (cats.length > 0) {
          const catIdx = Math.min(state.catIdx, cats.length - 1);
          state = { ...state, cats, catIdx };
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
      if (data === "\x1b[C") {
        cycle(1);
        return;
      }
      if (data === "\x1b[D") {
        cycle(-1);
        return;
      }
    });
  }

  draw();
  await new Promise<void>(() => {});
}
