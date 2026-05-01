import pc from "picocolors";
import { fetchRelay, fetchSchedule, todayDate } from "./api.ts";
import { renderScheduleList } from "./render.ts";
import { cmdStats } from "./stats.ts";
import {
  CURRENT_VERSION,
  getUpdateBanner,
  maybeTriggerBackgroundCheck,
  runBackgroundCheck,
  runUpdate,
} from "./update.ts";
import { watch } from "./watch.ts";

interface Args {
  cmd: "today" | "watch" | "update" | "stats";
  date: string;
  team?: string;
  game?: string;
  intervalSec: number;
  debug: boolean;
  help: boolean;
  statsView: "standings" | "batting" | "pitching";
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    cmd: "today",
    date: todayDate(),
    intervalSec: 5,
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
  else if (positional[0] === "stats") {
    args.cmd = "stats";
    if (positional[1] === "batting") args.statsView = "batting";
    else if (positional[1] === "pitching") args.statsView = "pitching";
    else args.statsView = "standings";
  } else if (positional[0] === "today" || positional[0] === undefined) args.cmd = "today";
  return args;
}

function printHelp(): void {
  console.log(`${pc.bold("kbo")} — KBO 라이브 중계 TUI

사용법:
  kbo                          오늘 경기 목록
  kbo today --date 2026-05-01  특정 날짜 경기 목록
  kbo watch                    진행중 경기 라이브 중계 (자동 선택)
  kbo watch --team LG          팀 자동 선택
  kbo watch --game <gameId>    특정 게임 ID
  kbo stats                    팀 순위 (인터랙티브 정렬)
  kbo stats batting            타자 리더보드
  kbo stats pitching           투수 리더보드
  kbo update                   최신 버전으로 업데이트
  kbo --version                현재 버전 출력

옵션:
  --interval <sec>   폴링 주기 (기본 5)
  --date <YYYY-MM-DD>
  --debug            raw 응답 dump
  -h, --help

환경 변수:
  KBO_NO_UPDATE_CHECK=1   백그라운드 업데이트 체크 비활성화

라이브/통계 화면 키:
  q          종료
  r          즉시 새로고침
  ←/→        watch: 진행중 경기 전환 · stats: 정렬/카테고리 전환
  ↑/↓        stats 순위: 뷰 토글 · stats 리더보드: 행 스크롤
  t          stats 리더보드: 팀 필터 cycling
`);
}

async function cmdToday(args: Args): Promise<void> {
  const games = await fetchSchedule(args.date);
  if (args.debug) {
    console.log(JSON.stringify(games, null, 2));
    return;
  }
  console.log(renderScheduleList(games, args.date));
}

async function cmdWatch(args: Args): Promise<void> {
  const games = await fetchSchedule(args.date);

  if (args.debug && args.game) {
    const relay = await fetchRelay(args.game);
    console.log(JSON.stringify(relay, null, 2));
    return;
  }

  let live = games.filter((g) => g.statusCode === "STARTED");

  // explicit gameId wins (even if not in 'live' list — e.g. recent game review)
  if (args.game) {
    const exact = games.find((g) => g.gameId === args.game);
    if (!exact) {
      console.error(pc.red(`gameId ${args.game} 를 ${args.date} 일정에서 찾지 못했습니다.`));
      process.exit(1);
    }
    live = [exact];
  } else if (args.team) {
    const filtered = live.filter(
      (g) => g.homeTeamName === args.team || g.awayTeamName === args.team
    );
    if (filtered.length === 0) {
      console.error(pc.red(`${args.team} 의 진행중 경기를 찾지 못했습니다.`));
      process.exit(1);
    }
    live = filtered;
  }

  if (live.length === 0) {
    console.log(pc.yellow("진행중인 KBO 경기가 없습니다.\n"));
    console.log(renderScheduleList(games, args.date));
    process.exit(0);
  }

  await watch({
    intervalSec: args.intervalSec,
    initialGameIndex: 0,
    liveGames: live,
  });
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

  if (args.cmd !== "update") {
    const banner = getUpdateBanner();
    if (banner) console.log(`${banner}\n`);
    maybeTriggerBackgroundCheck();
  }

  try {
    if (args.cmd === "today") await cmdToday(args);
    else if (args.cmd === "watch") await cmdWatch(args);
    else if (args.cmd === "stats") await cmdStats({ view: args.statsView, debug: args.debug });
    else if (args.cmd === "update") await runUpdate();
  } catch (e) {
    console.error(pc.red(`\n에러: ${(e as Error).message}`));
    process.exit(1);
  }
}

await main();
