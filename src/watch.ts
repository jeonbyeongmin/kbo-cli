import { fetchRelay, fetchSchedule, isPlayable, normalize, todayDate } from "./api.ts";
import {
  type LayoutMode,
  type RenderAnim,
  detectColumns,
  onResize,
  pickLayoutMode,
  recentViewportForMode,
  renderGame,
} from "./render.ts";
import type { NormalizedGame, ScheduleGame, TextRelayData } from "./types.ts";

// 애니메이션 타이밍. STARTED 에서만 구동한다.
const ANIM_INTERVAL_MS = 120; // ~8fps 리드로우
const PULSE_MS = 1400; // ● LIVE 맥동 주기
const FLASH_MS = 1400; // 득점 시 대형숫자 플래시 지속
const RUNNER_MS = 700; // 진루 이동 지속

type RunnerAnim = { toBase: "first" | "second" | "third"; start: number };

function recentViewportFor(layout: LayoutMode | "auto" | undefined): number {
  return recentViewportForMode(pickLayoutMode(detectColumns(), layout));
}

const ENTER_ALT = "\x1b[?1049h";
const EXIT_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const HOME = "\x1b[H";
const CLEAR_SCREEN = "\x1b[2J";
const CLEAR_AFTER = "\x1b[J";
const CLEAR_LINE = "\x1b[K";
const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_RIGHT = "\x1b[C";
const KEY_LEFT = "\x1b[D";

interface WatchOptions {
  intervalSec: number;
  initialGameIndex: number;
  liveGames: ScheduleGame[];
  layout?: LayoutMode | "auto";
  // 개발용: 네트워크 대신 이 relay 를 그대로 사용 (라이브 경기 없을 때 fixture 관전).
  fixtureRelay?: TextRelayData;
}

export async function watch(opts: WatchOptions): Promise<void> {
  let idx = opts.initialGameIndex;
  let lastGame: NormalizedGame | null = null;
  let lastFetch = 0;
  let lastError: string | null = null;
  let liveGames = opts.liveGames;
  let historyOffset = 0;

  // 모션 상태.
  let flashSide: "away" | "home" | null = null;
  let flashStart = 0;
  let runnerAnims: RunnerAnim[] = [];
  let animTimer: ReturnType<typeof setInterval> | null = null;

  // 폴링 결과의 점수·베이스 변화를 감지해 플래시/진루 애니를 트리거한다.
  const detectAnim = (prev: NormalizedGame | null, next: NormalizedGame): void => {
    if (!prev || prev.gameId !== next.gameId || next.status !== "STARTED") return;
    const now = Date.now();
    if (next.awayScore > prev.awayScore) {
      flashSide = "away";
      flashStart = now;
    }
    if (next.homeScore > prev.homeScore) {
      flashSide = "home";
      flashStart = now;
    }
    for (const b of ["first", "second", "third"] as const) {
      if (!prev.bases[b] && next.bases[b]) runnerAnims.push({ toBase: b, start: now });
    }
    runnerAnims = runnerAnims.filter((r) => now - r.start < RUNNER_MS);
  };

  const resetAnim = (): void => {
    flashSide = null;
    runnerAnims = [];
  };

  const currentAnim = (): RenderAnim | undefined => {
    if (!lastGame || lastGame.status !== "STARTED") return undefined;
    const now = Date.now();
    const pulse = 0.5 + 0.5 * Math.sin((now / PULSE_MS) * Math.PI * 2);
    const flash =
      flashSide && now - flashStart < FLASH_MS
        ? { side: flashSide, level: 1 - (now - flashStart) / FLASH_MS }
        : undefined;
    const runners = runnerAnims
      .filter((r) => now - r.start < RUNNER_MS)
      .map((r) => ({ toBase: r.toBase, t: (now - r.start) / RUNNER_MS }));
    return { pulse, flash, runners };
  };

  const ensureAnimTimer = (): void => {
    const live = lastGame?.status === "STARTED" && !!process.stdout.isTTY;
    if (live && !animTimer) {
      animTimer = setInterval(() => {
        if (!stopped) draw();
      }, ANIM_INTERVAL_MS);
    } else if (!live && animTimer) {
      clearInterval(animTimer);
      animTimer = null;
    }
  };

  const setHistoryOffset = (next: number) => {
    if (!lastGame || lastGame.status !== "STARTED") {
      historyOffset = 0;
      return;
    }
    const viewport = recentViewportFor(opts.layout);
    const maxOffset = Math.max(0, lastGame.recentPlays.length - viewport);
    historyOffset = Math.max(0, Math.min(next, maxOffset));
  };

  let stopped = false;
  let pollInFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  let offResize: (() => void) | null = null;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (animTimer) clearInterval(animTimer);
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
        historyOffset = 0;
        void poll();
        return;
      }
      if (data === KEY_UP) {
        setHistoryOffset(historyOffset + 1);
        draw();
        return;
      }
      if (data === KEY_DOWN) {
        setHistoryOffset(historyOffset - 1);
        draw();
        return;
      }
      if (data === KEY_RIGHT) {
        idx = (idx + 1) % liveGames.length;
        lastGame = null;
        historyOffset = 0;
        resetAnim();
        void poll();
        return;
      }
      if (data === KEY_LEFT) {
        idx = (idx - 1 + liveGames.length) % liveGames.length;
        lastGame = null;
        historyOffset = 0;
        resetAnim();
        void poll();
        return;
      }
    });
  }

  // 폴링 주기보다 살짝 여유 있게 임계값을 잡는다 — 5초 주기면 11초 넘어야 stale.
  const staleThreshold = opts.intervalSec * 2 + 1;

  const draw = () => {
    if (stopped) return;
    let body: string;
    if (lastGame) {
      // RESULT/READY/BEFORE/SUSPENDED 는 변할 일이 거의 없어 stale 경고가 의미 없음 — STARTED 만 표시.
      const stale = Math.floor((Date.now() - lastFetch) / 1000);
      const isLive = lastGame.status === "STARTED";
      body = renderGame(lastGame, {
        staleSec: isLive && stale > staleThreshold ? stale : 0,
        multiGame: liveGames.length > 1,
        layout: opts.layout,
        historyOffset,
        anim: currentAnim(),
      });
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
      const relay = opts.fixtureRelay ?? (await fetchRelay(sched.gameId));
      const prev = lastGame;
      lastGame = normalize(sched, relay);
      lastFetch = Date.now();
      lastError = null;
      detectAnim(prev, lastGame);
      ensureAnimTimer();
      setHistoryOffset(historyOffset);
    } catch (e) {
      lastError = `fetch 실패: ${(e as Error).message}`;
    } finally {
      pollInFlight = false;
      draw();
    }
  };

  // periodic refresh — BEFORE 가 STARTED 로 전환되거나 새 경기가 시작되는 걸 따라잡는다.
  const refreshSchedule = async () => {
    if (opts.fixtureRelay) return; // fixture 모드에서는 일정 갱신이 의미 없음
    try {
      const all = await fetchSchedule(todayDate());
      const playable = all.filter((g) => isPlayable(g.statusCode));
      if (playable.length > 0) liveGames = playable;
    } catch {
      // ignore
    }
  };

  // 리사이즈 시 mode 가 바뀌면 줄 수가 늘어 잔상이 남을 수 있어 한 번 전체
  // 클리어 후 다시 그린다. draw 자체가 detectColumns 를 매번 호출해 cols 를
  // 자동으로 따라잡으므로 별도 state 보관 불필요.
  offResize = onResize(() => {
    if (stopped) return;
    setHistoryOffset(historyOffset);
    process.stdout.write(CLEAR_SCREEN);
    draw();
  });

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
