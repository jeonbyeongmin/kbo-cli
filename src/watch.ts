import { fetchRelay, fetchSchedule, normalize, todayDate } from "./api.ts";
import { renderGame } from "./render.ts";
import type { NormalizedGame, ScheduleGame } from "./types.ts";

const ENTER_ALT = "\x1b[?1049h";
const EXIT_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const HOME = "\x1b[H";
const CLEAR_AFTER = "\x1b[J";
const CLEAR_LINE = "\x1b[K";

interface WatchOptions {
  intervalSec: number;
  initialGameIndex: number;
  liveGames: ScheduleGame[];
}

export async function watch(opts: WatchOptions): Promise<void> {
  let idx = opts.initialGameIndex;
  let lastGame: NormalizedGame | null = null;
  let lastFetch = 0;
  let lastError: string | null = null;
  let liveGames = opts.liveGames;

  let stopped = false;
  let pollInFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
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

  // raw key input
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
        void poll();
        return;
      }
      // arrow keys: \x1b[D = left, \x1b[C = right
      if (data === "\x1b[C") {
        idx = (idx + 1) % liveGames.length;
        lastGame = null;
        void poll();
        return;
      }
      if (data === "\x1b[D") {
        idx = (idx - 1 + liveGames.length) % liveGames.length;
        lastGame = null;
        void poll();
        return;
      }
    });
  }

  const draw = () => {
    if (stopped) return;
    let body: string;
    if (lastGame) {
      const stale = Math.floor((Date.now() - lastFetch) / 1000);
      body = renderGame(lastGame, { staleSec: stale });
    } else if (lastError) {
      body = `\n  ${lastError}\n`;
    } else {
      body = "\n  로딩 중...\n";
    }
    const ctxLine =
      liveGames.length > 1
        ? `\n  [${idx + 1}/${liveGames.length}] ${liveGames[idx]!.awayTeamName} vs ${liveGames[idx]!.homeTeamName}`
        : "";
    const out = `${body + ctxLine}\n`;

    // overwrite frame: home cursor, clear each line as we go
    process.stdout.write(HOME);
    const lines = out.split("\n");
    for (const line of lines) {
      process.stdout.write(`${CLEAR_LINE + line}\n`);
    }
    process.stdout.write(CLEAR_AFTER);
  };

  const poll = async () => {
    if (pollInFlight || stopped) return;
    pollInFlight = true;
    try {
      const sched = liveGames[idx]!;
      const relay = await fetchRelay(sched.gameId);
      lastGame = normalize(sched, relay);
      lastFetch = Date.now();
      lastError = null;
    } catch (e) {
      lastError = `fetch 실패: ${(e as Error).message}`;
    } finally {
      pollInFlight = false;
      draw();
    }
  };

  // periodic refresh of game schedule (in case more games go live)
  const refreshSchedule = async () => {
    try {
      const all = await fetchSchedule(todayDate());
      const live = all.filter((g) => g.statusCode === "STARTED");
      if (live.length > 0) liveGames = live;
    } catch {
      // ignore
    }
  };

  draw();
  await poll();

  const tick = async () => {
    if (stopped) return;
    await poll();
    if (Date.now() - lastFetch > 60_000) await refreshSchedule();
    timer = setTimeout(tick, opts.intervalSec * 1000);
  };
  timer = setTimeout(tick, opts.intervalSec * 1000);

  // hold the event loop
  await new Promise<void>(() => {});
}
