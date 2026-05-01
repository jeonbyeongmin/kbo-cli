export type GameStatus = "READY" | "STARTED" | "RESULT" | "CANCEL" | "SUSPENDED";

export interface ScheduleGame {
  gameId: string;
  categoryId: string;
  homeTeamCode: string;
  homeTeamName: string;
  homeTeamScore: number;
  awayTeamCode: string;
  awayTeamName: string;
  awayTeamScore: number;
  statusCode: GameStatus;
  statusInfo: string;
  gameDateTime: string;
  cancel: boolean;
  suspended: boolean;
}

export interface LineupPlayer {
  name: string;
  pcode: string;
  // API 가 lineup/entry 응답에서 동일 의미 필드를 다른 케이싱으로 내려줘 둘 다 둔다.
  pos?: string | number | null;
  posName?: string;
  hittype?: string | null;
  hitType?: string;
  pitchingStyle?: string | null;
  backnum?: string;
  seqno?: number;
  batOrder?: number;
  // batter stats (lineup only — entry는 이름/포지션만 보유)
  ab?: number;
  hit?: number;
  bb?: number;
  hbp?: number;
  hr?: number;
  rbi?: number;
  run?: number;
  so?: number;
  pa?: number;
  seasonHra?: number;
  todayHra?: number;
  psHra?: number;
  vsHra?: string;
  // pitcher stats
  kk?: number;
  er?: number;
  inn?: string;
  ballCount?: number;
  wp?: number;
  seasonEra?: string;
  todayEra?: number;
  vsEra?: string;
  psEra?: string;
}

export interface BatterStats {
  name: string;
  pcode: string;
  seasonAvg: string | null;
  todayAvg: string | null;
  todayLine: string | null;
  vsPitcher: string | null;
}

export interface PitcherStats {
  name: string;
  pcode: string;
  seasonEra: string | null;
  todayEra: string | null;
  todayLine: string | null;
}

export interface CurrentGameState {
  homeScore: string;
  awayScore: string;
  homeHit: string;
  awayHit: string;
  homeError: string;
  awayError: string;
  homeBallFour: string;
  awayBallFour: string;
  pitcher: string;
  batter: string;
  ball: string;
  strike: string;
  out: string;
  base1: string;
  base2: string;
  base3: string;
}

export interface TextRelayOption {
  text: string;
  type?: number;
  seqno?: number;
  currentGameState?: CurrentGameState;
}

export interface TextRelay {
  title: string;
  no: number;
  inn: number;
  homeOrAway: string;
  textOptions: TextRelayOption[];
}

export interface TextRelayData {
  category: string;
  gameId: string;
  no: number;
  inn: number;
  homeOrAway: string;
  inningScore: { home: Record<string, string>; away: Record<string, string> };
  homeEntry: { batter: LineupPlayer[]; pitcher: LineupPlayer[] };
  awayEntry: { batter: LineupPlayer[]; pitcher: LineupPlayer[] };
  homeLineup: { batter: LineupPlayer[]; pitcher: LineupPlayer[] };
  awayLineup: { batter: LineupPlayer[]; pitcher: LineupPlayer[] };
  currentGameState: CurrentGameState;
  textRelays: TextRelay[];
  pitcherVsBatterCareerStats?: string;
}

export interface Season {
  category: string;
  year: number;
  seasonCode: string;
  title: string;
  startDate?: string;
  endDate?: string;
  isSeason?: string;
  isEnable?: string;
  currentGameType?: string;
}

export interface TeamStat {
  teamId: string;
  teamName: string;
  teamShortName?: string;
  teamImageUrl?: string;
  seasonId?: string;
  year?: number;
  upperCategoryId?: string;
  categoryId?: string;
  gameType?: string;
  ranking: number;
  wra: number | null;
  gameCount: number | null;
  winGameCount: number | null;
  drawnGameCount: number | null;
  loseGameCount: number | null;
  gameBehind: number | null;
  continuousGameResult?: string;
  lastFiveGames?: string;
  // 공격
  offenseHra?: number | null;
  offenseRun?: number | null;
  offenseHr?: number | null;
  offenseRbi?: number | null;
  offenseHit?: number | null;
  offenseH2?: number | null;
  offenseH3?: number | null;
  offenseSb?: number | null;
  offenseBb?: number | null;
  offenseHp?: number | null;
  offenseBbhp?: number | null;
  offenseKk?: number | null;
  offenseObp?: number | null;
  offenseSlg?: number | null;
  offenseOps?: number | null;
  // 수비/투수
  defenseEra?: number | null;
  defenseInning?: number | null;
  defenseHit?: number | null;
  defenseHr?: number | null;
  defenseKk?: number | null;
  defenseErr?: number | null;
  defenseWhip?: number | null;
  defenseQs?: number | null;
  defenseSave?: number | null;
  defenseHold?: number | null;
  defenseWp?: number | null;
}

export interface PlayerRanking {
  ranking: number;
  playerId: string;
  playerName: string;
  playerImageUrl?: string;
  backNumber?: number;
  teamId: string;
  teamName: string;
  teamShortName?: string;
  teamImageUrl?: string;
  seasonId?: string;
  categoryId?: string;
  // 카테고리에 따라 채워지는 필드 (네이버 응답 그대로)
  hitterHra?: number | null;
  hitterHr?: number | null;
  hitterRbi?: number | null;
  hitterRun?: number | null;
  hitterHit?: number | null;
  hitterH2?: number | null;
  hitterH3?: number | null;
  hitterAb?: number | null;
  hitterSb?: number | null;
  hitterBb?: number | null;
  hitterKk?: number | null;
  hitterObp?: number | null;
  hitterSlg?: number | null;
  hitterOps?: number | null;
  hitterIsop?: number | null;
  pitcherEra?: number | null;
  pitcherWin?: number | null;
  pitcherLose?: number | null;
  pitcherInning?: string | number | null;
  pitcherKk?: number | null;
  pitcherSave?: number | null;
  pitcherHold?: number | null;
  pitcherWhip?: number | null;
  pitcherBb?: number | null;
  pitcherHit?: number | null;
  [key: string]: unknown;
}

export interface TopPlayerCategory {
  type: string;
  rankings: PlayerRanking[];
}

export interface NormalizedGame {
  gameId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamCode: string;
  awayTeamCode: string;
  homeScore: number;
  awayScore: number;
  inning: number;
  topBottom: "top" | "bottom";
  ball: number;
  strike: number;
  out: number;
  bases: { first: boolean; second: boolean; third: boolean };
  batterStats: BatterStats | null;
  pitcherStats: PitcherStats | null;
  recentPlays: string[];
  inningLine: { home: string[]; away: string[] };
  status: GameStatus;
  fetchedAt: number;
}
