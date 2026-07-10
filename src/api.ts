import type {
  BatterStats,
  CurrentGameState,
  GameStatus,
  LineupPlayer,
  LineupSlot,
  MetricOption,
  NormalizedGame,
  PitchMark,
  PitcherStats,
  PlayerRanking,
  PtsPitch,
  RHEB,
  ScheduleGame,
  TeamStat,
  TextRelay,
  TextRelayData,
  TextRelayOption,
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

export async function fetchSchedule(date: string, timeoutMs?: number): Promise<ScheduleGame[]> {
  // date= 파라미터는 2026-07 경 무공지 폐기돼 항상 빈 배열을 반환 — fromDate/toDate 로 조회한다.
  const data = await getJson<{ games: ScheduleGame[] }>(
    `/schedule/games?upperCategoryId=kbaseball&fromDate=${date}&toDate=${date}`,
    timeoutMs
  );
  return data.games.filter((g) => g.categoryId === "kbo" && g.homeTeamName && g.awayTeamName);
}

// BEFORE 상태 게임은 textRelayData 가 null 로 내려온다.
export async function fetchRelay(
  gameId: string,
  timeoutMs?: number
): Promise<TextRelayData | null> {
  const data = await getJson<{ textRelayData: TextRelayData | null }>(
    `/schedule/games/${gameId}/relay`,
    timeoutMs
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

// 투구 옵션(type===1)이면 구종·구속을 병기 — "1구 파울" → "1구 파울 · 슬라이더 127km/h".
function pitchAnnotatedText(opt: TextRelayOption): string {
  const txt = (opt.text ?? "").trim();
  if (opt.type !== 1) return txt;
  const stuff = typeof opt.stuff === "string" ? opt.stuff.trim() : "";
  const speed = Number(opt.speed);
  if (!stuff || !Number.isFinite(speed) || speed <= 0) return txt;
  return `${txt} · ${stuff} ${speed}km/h`;
}

function collectRecentPlays(relay: TextRelayData, max = 100): string[] {
  const plays: { seq: number; text: string }[] = [];
  for (const ab of relay.textRelays) {
    for (const opt of ab.textOptions) {
      const txt = pitchAnnotatedText(opt);
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

// textRelays 를 최신(no 내림차순) 순으로. API 가 이미 정렬해 주지만 보장이 없어 방어적으로 정렬.
function relaysNewestFirst(relay: TextRelayData): TextRelay[] {
  return [...relay.textRelays].sort((a, b) => (b.no ?? 0) - (a.no ?? 0));
}

// 승리 확률. 최신 relay 의 metricOption 은 0/0 sentinel 일 수 있어 비0 첫 항목을 찾고,
// 없으면 lastValidMetricOption 폴백. 그것도 0/0 이면 null (경기 초반/미제공).
function pickWinRate(relay: TextRelayData): { home: number; away: number } | null {
  const read = (m: MetricOption | undefined): { home: number; away: number } | null => {
    if (!m) return null;
    const home = Number(m.homeTeamWinRate);
    const away = Number(m.awayTeamWinRate);
    if (!Number.isFinite(home) || !Number.isFinite(away) || home + away <= 0) return null;
    return { home, away };
  };
  for (const tr of relaysNewestFirst(relay)) {
    const v = read(tr.metricOption);
    if (v) return v;
  }
  return read(relay.lastValidMetricOption);
}

// PTS 운동학으로 플레이트 통과 높이(ft)를 계산. crossPlateY 평면 도달 시각 t 를
// y(t)=y0+vy0·t+ay·t²/2 에서 구해 z(t) 를 평가한다. 데이터 결손/비물리 값은 null.
function plateZ(p: PtsPitch): number | null {
  const { y0, vy0, ay, z0, vz0, az, crossPlateY } = p;
  if (y0 == null || vy0 == null || ay == null || z0 == null || vz0 == null || az == null)
    return null;
  const targetY = crossPlateY ?? 1.417; // 결측 시 플레이트 근처 기본값
  const disc = vy0 * vy0 - 2 * ay * (y0 - targetY);
  if (!(disc >= 0)) return null;
  const t = ay !== 0 ? (-vy0 - Math.sqrt(disc)) / ay : (targetY - y0) / vy0;
  if (!Number.isFinite(t) || t <= 0) return null;
  const z = z0 + vz0 * t + (az * t * t) / 2;
  return Number.isFinite(z) ? z : null;
}

const DEFAULT_SZ = { top: 3.4, bottom: 1.6 } as const;

// 현재(최신) 타석의 투구들. type===1 textOptions 와 ptsOptions 를 pitchNum↔ballcount 로 조인.
function parseCurrentAtBat(relay: TextRelayData): PitchMark[] {
  for (const tr of relaysNewestFirst(relay)) {
    const pitchOpts = tr.textOptions.filter((o) => o.type === 1 && o.pitchNum != null);
    if (pitchOpts.length === 0) continue;
    const pts = new Map<number, PtsPitch>();
    for (const p of tr.ptsOptions ?? []) {
      if (p.ballcount != null) pts.set(p.ballcount, p);
    }
    const marks: PitchMark[] = pitchOpts.map((o) => {
      const p = pts.get(o.pitchNum!);
      const speed = Number(o.speed);
      const topSz = p?.topSz && p.topSz > 0 ? p.topSz : DEFAULT_SZ.top;
      const bottomSz = p?.bottomSz && p.bottomSz > 0 ? p.bottomSz : DEFAULT_SZ.bottom;
      return {
        num: o.pitchNum!,
        result: (o.pitchResult ?? "").trim(),
        resultText: (o.text ?? "").trim().replace(/^\d+구\s*/, ""),
        stuff: typeof o.stuff === "string" && o.stuff.trim() ? o.stuff.trim() : null,
        speedKmh: Number.isFinite(speed) && speed > 0 ? speed : null,
        x: p?.crossPlateX ?? null,
        z: p ? plateZ(p) : null,
        topSz,
        bottomSz,
        stance: p?.stance ?? null,
      };
    });
    marks.sort((a, b) => a.num - b.num);
    return marks;
  }
  return [];
}

// 타순표. 교체로 같은 batOrder 가 중복되면 seqno 최대(=현재 투입 선수)만 남긴다.
function buildLineupSlots(batters: LineupPlayer[]): LineupSlot[] {
  const byOrder = new Map<number, LineupPlayer>();
  for (const p of batters) {
    if (p.batOrder == null || p.batOrder < 1) continue;
    const cur = byOrder.get(p.batOrder);
    if (!cur || (p.seqno ?? 0) > (cur.seqno ?? 0)) byOrder.set(p.batOrder, p);
  }
  return [...byOrder.entries()]
    .sort(([a], [b]) => a - b)
    .map(([batOrder, p]) => ({
      batOrder,
      pos: (p.posName ?? "").slice(0, 1) || "-",
      name: p.name,
      pcode: p.pcode,
      todayAvg: p.pa != null && p.pa > 0 ? fmtAvg(p.todayHra) : null,
      hitAb: p.ab != null ? `${p.hit ?? 0}-${p.ab}` : null,
    }));
}

function buildLineups(relay: TextRelayData): NormalizedGame["lineups"] {
  const home = buildLineupSlots(relay.homeLineup?.batter ?? []);
  const away = buildLineupSlots(relay.awayLineup?.batter ?? []);
  if (home.length === 0 && away.length === 0) return null;
  return { home, away };
}

// STARTED 중 schedule 에 rheb 가 없을 때 currentGameState 로 라이브 R/H/E/B 를 만든다.
function rhebFromState(cs: CurrentGameState, side: "home" | "away", score: number): RHEB | null {
  const h = Number(side === "home" ? cs.homeHit : cs.awayHit);
  const e = Number(side === "home" ? cs.homeError : cs.awayError);
  const b = Number(side === "home" ? cs.homeBallFour : cs.awayBallFour);
  if (!Number.isFinite(h) || !Number.isFinite(e) || !Number.isFinite(b)) return null;
  return { r: score, h, e, b };
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
      winRate: null,
      currentAtBatPitches: [],
      lineups: null,
      currentBatterPcode: null,
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
    winRate: pickWinRate(relay),
    currentAtBatPitches: parseCurrentAtBat(relay),
    lineups: buildLineups(relay),
    currentBatterPcode: cs.batter?.trim() ? cs.batter : null,
    status: schedule.statusCode,
    fetchedAt: Date.now(),
    ...scheduleMeta(schedule),
    // 라이브 중엔 schedule 의 rheb 가 비어있을 수 있어 currentGameState 로 보충.
    homeRheb:
      parseRheb(schedule.homeTeamRheb) ?? rhebFromState(cs, "home", Number(cs.homeScore ?? 0)),
    awayRheb:
      parseRheb(schedule.awayTeamRheb) ?? rhebFromState(cs, "away", Number(cs.awayScore ?? 0)),
  };
}

export function todayDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
