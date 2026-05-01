import type {
  BatterStats,
  CurrentGameState,
  GameStatus,
  LineupPlayer,
  NormalizedGame,
  PitcherStats,
  PlayerRanking,
  RHEB,
  ScheduleGame,
  TeamStat,
  TextRelayData,
  TopPlayerCategory,
} from "./types.ts";

// watch 가 자동 선택하는 상태. CANCEL 만 제외 — 점수/라인업/결과가 모두 비어 박스 가치가 낮다.
export function isPlayable(status: GameStatus): boolean {
  return (
    status === "STARTED" ||
    status === "BEFORE" ||
    status === "READY" ||
    status === "RESULT" ||
    status === "SUSPENDED"
  );
}

const BASE = "https://api-gw.sports.naver.com";
const UA = "kbo-cli/0.1 (+https://github.com/jeonbyeongmin/kbo-cli; personal use)";

class HttpError extends Error {
  constructor(
    public status: number,
    public path: string,
    body: string
  ) {
    super(`HTTP ${status} ${path}: ${body.slice(0, 120)}`);
  }
}

async function getJson<T>(path: string, timeoutMs = 5000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, path, text);
    const json = JSON.parse(text) as { code: number; success: boolean; result: T };
    if (!json.success) throw new HttpError(res.status, path, text);
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchSchedule(date: string): Promise<ScheduleGame[]> {
  const data = await getJson<{ games: ScheduleGame[] }>(
    `/schedule/games?upperCategoryId=kbaseball&date=${date}`
  );
  return data.games.filter((g) => g.categoryId === "kbo" && g.homeTeamName && g.awayTeamName);
}

// BEFORE 상태 게임은 textRelayData 가 null 로 내려온다.
export async function fetchRelay(gameId: string): Promise<TextRelayData | null> {
  const data = await getJson<{ textRelayData: TextRelayData | null }>(
    `/schedule/games/${gameId}/relay`
  );
  return data.textRelayData;
}

export async function fetchGameBasic(gameId: string): Promise<ScheduleGame> {
  const data = await getJson<{ game: ScheduleGame }>(`/schedule/games/${gameId}`);
  return data.game;
}

// statistics 계열은 categoryId 가 "kbo" — schedule 의 "kbaseball" 과 다르다.
const STATS_CATEGORY = "kbo";

export async function fetchStandings(seasonCode: string): Promise<TeamStat[]> {
  const data = await getJson<{ seasonTeamStats: TeamStat[] }>(
    `/statistics/categories/${STATS_CATEGORY}/seasons/${seasonCode}/teams`
  );
  return data.seasonTeamStats ?? [];
}

export async function fetchLeaderboards(
  seasonCode: string,
  playerType: "HITTER" | "PITCHER"
): Promise<TopPlayerCategory[]> {
  const data = await getJson<{ topPlayers: TopPlayerCategory[] }>(
    `/statistics/categories/${STATS_CATEGORY}/seasons/${seasonCode}/top-players?playerType=${playerType}&limit=30&includeFields=`
  );
  return data.topPlayers ?? [];
}

export interface FetchPlayersOptions {
  playerType: "HITTER" | "PITCHER";
  field: string;
  direction: "ASC" | "DESC";
  teamCode?: string;
  pageSize?: number;
}

export async function fetchPlayers(
  seasonCode: string,
  opts: FetchPlayersOptions
): Promise<PlayerRanking[]> {
  const params = new URLSearchParams({
    playerType: opts.playerType,
    field: opts.field,
    direction: opts.direction,
    pageSize: String(opts.pageSize ?? 100),
    page: "1",
  });
  if (opts.teamCode) params.set("teamCode", opts.teamCode);
  const data = await getJson<{ seasonPlayerStats: PlayerRanking[] }>(
    `/statistics/categories/${STATS_CATEGORY}/seasons/${seasonCode}/players?${params}`
  );
  return data.seasonPlayerStats ?? [];
}

export function currentSeasonCode(): string {
  return String(new Date().getFullYear());
}

function findPlayer(...lineups: LineupPlayer[][]): (pcode: string) => LineupPlayer | null {
  return (pcode: string) => {
    for (const list of lineups) {
      const hit = list.find((p) => p.pcode === pcode);
      if (hit) return hit;
    }
    return null;
  };
}

function fmtAvg(n: number | undefined | null): string | null {
  if (n == null || Number.isNaN(n)) return null;
  // 0.278 → ".278", 1.000 → "1.000"
  const s = n.toFixed(3);
  return s.startsWith("0.") ? s.slice(1) : s;
}

function buildBatterStats(
  p: LineupPlayer | null,
  vsCareer: string | undefined
): BatterStats | null {
  if (!p) return null;
  const seasonAvg = fmtAvg(p.seasonHra);
  const todayAvg = p.pa != null && p.pa > 0 ? fmtAvg(p.todayHra) : null;
  const parts: string[] = [];
  if (p.ab != null) parts.push(`${p.ab}타수`);
  if (p.hit != null && p.hit > 0) parts.push(`${p.hit}안타`);
  if (p.hr != null && p.hr > 0) parts.push(`${p.hr}홈런`);
  if (p.rbi != null && p.rbi > 0) parts.push(`${p.rbi}타점`);
  if (p.bb != null && p.bb > 0) parts.push(`${p.bb}볼넷`);
  if (p.so != null && p.so > 0) parts.push(`${p.so}삼진`);
  const todayLine = parts.length > 0 ? parts.join(" ") : null;
  return {
    name: p.name,
    pcode: p.pcode,
    seasonAvg,
    todayAvg,
    todayLine,
    vsPitcher: vsCareer?.trim() ? vsCareer.trim() : null,
  };
}

function buildPitcherStats(p: LineupPlayer | null): PitcherStats | null {
  if (!p) return null;
  const seasonEra = p.seasonEra?.trim() ? p.seasonEra : null;
  const todayEra =
    p.todayEra != null && !Number.isNaN(p.todayEra) ? Number(p.todayEra).toFixed(2) : null;
  const parts: string[] = [];
  if (p.inn) parts.push(`${p.inn}이닝`);
  if (p.er != null) parts.push(`${p.er}자책`);
  if (p.kk != null && p.kk > 0) parts.push(`${p.kk}K`);
  if (p.bb != null && p.bb > 0) parts.push(`${p.bb}BB`);
  if (p.hit != null && p.hit > 0) parts.push(`${p.hit}피안타`);
  if (p.ballCount != null && p.ballCount > 0) parts.push(`${p.ballCount}구`);
  const todayLine = parts.length > 0 ? parts.join(" ") : null;
  return { name: p.name, pcode: p.pcode, seasonEra, todayEra, todayLine };
}

// API 가 이닝 구분으로 끼워넣는 sentinel — 의미 없으니 항상 제거.
const SENTINEL_RE = /^=+$/;

function collectRecentPlays(relay: TextRelayData, max = 6): string[] {
  const plays: { seq: number; text: string }[] = [];
  for (const ab of relay.textRelays) {
    for (const opt of ab.textOptions) {
      const txt = (opt.text ?? "").trim();
      if (!txt) continue;
      if (SENTINEL_RE.test(txt)) continue;
      plays.push({ seq: opt.seqno ?? 0, text: txt });
    }
  }
  plays.sort((a, b) => b.seq - a.seq);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of plays) {
    if (seen.has(p.text)) continue;
    seen.add(p.text);
    out.push(p.text);
    if (out.length >= max) break;
  }
  return out;
}

function parseRheb(arr: number[] | null | undefined): RHEB | null {
  if (!arr || arr.length < 4) return null;
  return { r: arr[0]!, h: arr[1]!, e: arr[2]!, b: arr[3]! };
}

function scheduleMeta(
  schedule: ScheduleGame
): Pick<
  NormalizedGame,
  | "gameDateTime"
  | "stadium"
  | "weather"
  | "broadChannel"
  | "winner"
  | "homeStarter"
  | "awayStarter"
  | "winPitcher"
  | "losePitcher"
  | "homeRheb"
  | "awayRheb"
> {
  return {
    gameDateTime: schedule.gameDateTime,
    stadium: schedule.stadium ?? null,
    weather: schedule.weatherInfo?.weather ?? null,
    broadChannel: schedule.broadChannel ?? null,
    winner: schedule.winner ?? null,
    homeStarter: schedule.homeStarterName ?? null,
    awayStarter: schedule.awayStarterName ?? null,
    winPitcher: schedule.winPitcherName ?? null,
    losePitcher: schedule.losePitcherName ?? null,
    homeRheb: parseRheb(schedule.homeTeamRheb),
    awayRheb: parseRheb(schedule.awayTeamRheb),
  };
}

export function normalize(schedule: ScheduleGame, relay: TextRelayData | null): NormalizedGame {
  if (!relay) {
    return {
      gameId: schedule.gameId,
      homeTeamName: schedule.homeTeamName,
      awayTeamName: schedule.awayTeamName,
      homeTeamCode: schedule.homeTeamCode,
      awayTeamCode: schedule.awayTeamCode,
      homeScore: Number(schedule.homeTeamScore ?? 0),
      awayScore: Number(schedule.awayTeamScore ?? 0),
      inning: 1,
      topBottom: "top",
      ball: 0,
      strike: 0,
      out: 0,
      bases: { first: false, second: false, third: false },
      batterStats: null,
      pitcherStats: null,
      recentPlays: [],
      inningLine: { home: [], away: [] },
      status: schedule.statusCode,
      fetchedAt: Date.now(),
      ...scheduleMeta(schedule),
    };
  }
  const cs: CurrentGameState = relay.currentGameState;
  const awayBatting = relay.homeOrAway === "0";
  const findBatter = awayBatting
    ? findPlayer(relay.awayLineup.batter, relay.awayEntry.batter)
    : findPlayer(relay.homeLineup.batter, relay.homeEntry.batter);
  const findPitcher = awayBatting
    ? findPlayer(relay.homeLineup.pitcher, relay.homeEntry.pitcher)
    : findPlayer(relay.awayLineup.pitcher, relay.awayEntry.pitcher);
  const batterPlayer = findBatter(cs.batter);
  const pitcherPlayer = findPitcher(cs.pitcher);

  const inningLineHome: string[] = [];
  const inningLineAway: string[] = [];
  const maxInning = Math.max(
    ...Object.keys(relay.inningScore?.home ?? {}).map(Number),
    ...Object.keys(relay.inningScore?.away ?? {}).map(Number),
    1
  );
  for (let i = 1; i <= maxInning; i++) {
    inningLineHome.push(relay.inningScore?.home?.[String(i)] ?? "-");
    inningLineAway.push(relay.inningScore?.away?.[String(i)] ?? "-");
  }

  return {
    gameId: schedule.gameId,
    homeTeamName: schedule.homeTeamName,
    awayTeamName: schedule.awayTeamName,
    homeTeamCode: schedule.homeTeamCode,
    awayTeamCode: schedule.awayTeamCode,
    homeScore: Number(cs.homeScore ?? 0),
    awayScore: Number(cs.awayScore ?? 0),
    inning: relay.inn ?? 1,
    topBottom: awayBatting ? "top" : "bottom",
    ball: Number(cs.ball ?? 0),
    strike: Number(cs.strike ?? 0),
    out: Number(cs.out ?? 0),
    bases: {
      first: cs.base1 !== "0" && cs.base1 !== "",
      second: cs.base2 !== "0" && cs.base2 !== "",
      third: cs.base3 !== "0" && cs.base3 !== "",
    },
    batterStats: buildBatterStats(batterPlayer, relay.pitcherVsBatterCareerStats),
    pitcherStats: buildPitcherStats(pitcherPlayer),
    recentPlays: collectRecentPlays(relay),
    inningLine: { home: inningLineHome, away: inningLineAway },
    status: schedule.statusCode,
    fetchedAt: Date.now(),
    ...scheduleMeta(schedule),
  };
}

export function todayDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
