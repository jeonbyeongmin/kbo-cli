import pc from "picocolors";
import {
  fetchGameBasic,
  fetchRelay,
  fetchSchedule,
  isPlayable,
  normalize,
  todayDate,
} from "./api.ts";
import { readCache, writeCache } from "./cache.ts";
import { cmdConfig, loadConfig } from "./config.ts";
import { pickStatusGame, renderOneline } from "./oneline.ts";
import { TEAM_NAMES, colorTeam, renderScheduleList } from "./render.ts";
import { cmdStats } from "./stats.ts";
import type { GameStatus } from "./types.ts";
import {
  CURRENT_VERSION,
  getUpdateBanner,
  maybeTriggerBackgroundCheck,
  runBackgroundCheck,
  runUpdate,
} from "./update.ts";
import { watch } from "./watch.ts";

interface Args {
  cmd: "auto" | "today" | "watch" | "update" | "stats" | "config" | "status";
  date: string;
  team?: string;
  game?: string;
  intervalSec?: number;
  debug: boolean;
  help: boolean;
  statsView: "standings" | "batting" | "pitching";
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    cmd: "auto",
    date: todayDate(),
    debug: false,
    help: false,
    statsView: "standings",
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--debug") args.debug = true;
    else if (a === "--team") args.team = argv[++i];
    else if (a === "--game") args.game = argv[++i];
    else if (a === "--date") args.date = argv[++i] ?? args.date;
    else if (a === "--interval") args.intervalSec = Math.max(1, Number(argv[++i]) || 5);
    else if (!a.startsWith("--")) positional.push(a);
  }
  if (positional[0] === "watch") args.cmd = "watch";
  else if (positional[0] === "update") args.cmd = "update";
  else if (positional[0] === "config") args.cmd = "config";
  else if (positional[0] === "status") args.cmd = "status";
  else if (positional[0] === "stats") {
    args.cmd = "stats";
    if (positional[1] === "batting") args.statsView = "batting";
    else if (positional[1] === "pitching") args.statsView = "pitching";
    else args.statsView = "standings";
  } else if (positional[0] === "today") args.cmd = "today";
  return args;
}

function printHelp(): void {
  console.log(`${pc.bold("kbo")} — KBO 라이브 중계 TUI

사용법:
  kbo                          오늘 경기 목록 (즐겨찾기 팀 라이브 시 watch 자동)
  kbo today --date 2026-05-01  특정 날짜 경기 목록
  kbo watch                    진행중 경기 라이브 중계 (자동 선택)
  kbo watch --team LG          팀 자동 선택
  kbo watch --game <gameId>    특정 게임 ID
  kbo stats                    팀 순위 (인터랙티브 정렬)
  kbo stats batting            타자 리더보드
  kbo stats pitching           투수 리더보드
  kbo config                   즐겨찾기 팀 등 설정 (인터랙티브)
  kbo update                   최신 버전으로 업데이트
  kbo --version                현재 버전 출력

옵션:
  --interval <sec>   폴링 주기 (기본 5, config 폴백)
  --date <YYYY-MM-DD>
  --debug            raw 응답 dump
  -h, --help

환경 변수:
  KBO_NO_UPDATE_CHECK=1   백그라운드 업데이트 체크 비활성화
  KBO_NO_HINT=1           온보딩 힌트 비활성화

라이브/통계 화면 키:
  q          종료
  r          즉시 새로고침
  ←/→        watch: 진행중 경기 전환 · stats: 정렬/카테고리 전환 · config: 값 변경
  ↑/↓        stats 순위: 뷰 토글 · stats 리더보드: 행 스크롤 · config: 항목 이동
  t          stats 리더보드: 팀 필터 cycling
  s/Enter    config: 저장 후 종료
`);
}

function matchesTeam(g: { homeTeamName: string; awayTeamName: string }, name: string): boolean {
  return g.homeTeamName === name || g.awayTeamName === name;
}

async function cmdToday(args: Args): Promise<void> {
  const games = await fetchSchedule(args.date);
  if (args.debug) {
    console.log(JSON.stringify(games, null, 2));
    return;
  }
  const favoriteTeam = loadConfig().favoriteTeam;
  console.log(renderScheduleList(games, args.date, favoriteTeam));
}

async function cmdAuto(args: Args): Promise<void> {
  const favoriteTeam = loadConfig().favoriteTeam;
  if (!favoriteTeam) {
    await cmdToday(args);
    return;
  }
  const games = await fetchSchedule(args.date);
  const liveFavorite = games.find((g) => {
    const live =
      g.statusCode === "STARTED" ||
      g.statusCode === "BEFORE" ||
      g.statusCode === "READY" ||
      g.statusCode === "SUSPENDED";
    return live && matchesTeam(g, favoriteTeam);
  });
  if (liveFavorite) {
    console.log(pc.dim(`즐겨찾기 팀 ${favoriteTeam} 라이브 — watch 모드 진입`));
    await cmdWatch(args);
  } else {
    await cmdToday(args);
  }
}

// watch 박스 회전 순서 — 라이브 > 시작 전 > 중단 > 종료. isPlayable 에서 빠진 status 는 정의하지 않는다.
const STATUS_RANK: Partial<Record<GameStatus, number>> = {
  STARTED: 0,
  BEFORE: 1,
  READY: 1,
  SUSPENDED: 2,
  RESULT: 3,
};

async function cmdWatch(args: Args): Promise<void> {
  const cfg = loadConfig();
  const games = await fetchSchedule(args.date);

  if (args.debug && args.game) {
    const relay = await fetchRelay(args.game);
    console.log(JSON.stringify(relay, null, 2));
    return;
  }

  // 라이브가 가장 먼저, 그 다음 곧 시작 → 중단 → 종료 순. 같은 그룹 안에서는 시간순.
  let live = games.filter((g) => isPlayable(g.statusCode));
  live.sort((a, b) => {
    const ra = STATUS_RANK[a.statusCode] ?? 99;
    const rb = STATUS_RANK[b.statusCode] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.gameDateTime.localeCompare(b.gameDateTime);
  });

  // explicit gameId wins (even if not in 'live' list — e.g. recent game review)
  let initialIndex = 0;
  if (args.game) {
    const exact = games.find((g) => g.gameId === args.game);
    if (!exact) {
      console.error(pc.red(`gameId ${args.game} 를 ${args.date} 일정에서 찾지 못했습니다.`));
      process.exit(1);
    }
    live = [exact];
  } else if (args.team) {
    const filtered = live.filter((g) => matchesTeam(g, args.team!));
    if (filtered.length === 0) {
      console.error(pc.red(`${args.team} 의 경기를 찾지 못했습니다.`));
      process.exit(1);
    }
    live = filtered;
  } else {
    // 폴백 (즐겨찾기 팀): 필터링하지 않고 시작 인덱스만 즐겨찾기 팀 경기로 맞춘다.
    // ←/→ 로 다른 경기도 그대로 순환할 수 있게.
    const fallbackTeam = cfg.favoriteTeam;
    if (fallbackTeam) {
      const idx = live.findIndex((g) => matchesTeam(g, fallbackTeam));
      if (idx >= 0) initialIndex = idx;
      else console.log(pc.dim(`즐겨찾기 팀 ${fallbackTeam} 경기 없음 — 전체 표시`));
    }
  }

  if (live.length === 0) {
    console.log(pc.yellow("관전 가능한 KBO 경기가 없습니다.\n"));
    console.log(renderScheduleList(games, args.date));
    process.exit(0);
  }

  // /schedule/games 응답은 stadium/starter/weather 등이 비어있어 단일 게임 endpoint 로 보강.
  const enriched = await Promise.all(live.map((g) => fetchGameBasic(g.gameId).catch(() => g)));

  await watch({
    intervalSec: args.intervalSec ?? cfg.interval ?? 5,
    initialGameIndex: initialIndex,
    liveGames: enriched,
  });
}

interface StatusCacheEntry {
  line: string;
  exitCode: number;
}

const STATUS_CACHE_TTL_MS = 30 * 1000;

async function cmdStatus(args: Args): Promise<number> {
  const team = args.team ?? loadConfig().favoriteTeam;
  if (!team) {
    console.error(
      pc.red(
        "팀이 지정되지 않았습니다. --team <팀명> 또는 kbo config 로 즐겨찾기 팀을 설정하세요."
      )
    );
    return 1;
  }
  if (!TEAM_NAMES.includes(team)) {
    console.error(
      pc.red(`알 수 없는 팀 이름: ${team} (사용 가능: ${TEAM_NAMES.join(", ")})`)
    );
    return 1;
  }

  const cacheKey = `${args.date}-${team}`;
  const cached = readCache<StatusCacheEntry>(cacheKey, STATUS_CACHE_TTL_MS);
  if (cached) {
    console.log(cached.line);
    return cached.exitCode;
  }

  const games = await fetchSchedule(args.date);
  const picked = pickStatusGame(games, team);

  if (!picked) {
    const line = `${colorTeam(team)} · 오늘 경기 없음`;
    console.log(line);
    writeCache<StatusCacheEntry>(cacheKey, { line, exitCode: 2 });
    return 2;
  }

  // STARTED/SUSPENDED 만 라이브 정보 (이닝/카운트/주자/타투수) 가 의미 있어 relay 를 받는다.
  // BEFORE/READY/RESULT 는 schedule 메타만으로 충분.
  const needsRelay = picked.statusCode === "STARTED" || picked.statusCode === "SUSPENDED";
  const relay = needsRelay ? await fetchRelay(picked.gameId).catch(() => null) : null;
  const normalized = normalize(picked, relay);

  const line = renderOneline(normalized, team);
  console.log(line);

  const exitCode = picked.statusCode === "RESULT" ? 3 : 0;
  writeCache<StatusCacheEntry>(cacheKey, { line, exitCode });
  return exitCode;
}

function getOnboardingHint(): string | null {
  if (!process.stdout.isTTY) return null;
  if (process.env.KBO_NO_HINT === "1") return null;
  if (loadConfig().favoriteTeam) return null;
  return pc.dim("tip: kbo config 로 즐겨찾기 팀을 설정하면 이 화면이 더 편해집니다");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === "__update-check") {
    await runBackgroundCheck();
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(`v${CURRENT_VERSION}`);
    return;
  }

  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  // status 는 한 줄 출력이 핵심이라 banner/hint/background-check 모두 스킵.
  if (args.cmd !== "update" && args.cmd !== "status") {
    const banner = getUpdateBanner();
    if (banner) console.log(`${banner}\n`);
    const hint = getOnboardingHint();
    if (hint) console.log(`${hint}\n`);
    maybeTriggerBackgroundCheck();
  }

  try {
    if (args.cmd === "auto") await cmdAuto(args);
    else if (args.cmd === "today") await cmdToday(args);
    else if (args.cmd === "watch") await cmdWatch(args);
    else if (args.cmd === "stats") await cmdStats({ view: args.statsView, debug: args.debug });
    else if (args.cmd === "config") await cmdConfig();
    else if (args.cmd === "update") await runUpdate();
    else if (args.cmd === "status") process.exit(await cmdStatus(args));
  } catch (e) {
    console.error(pc.red(`\n에러: ${(e as Error).message}`));
    process.exit(1);
  }
}

await main();
