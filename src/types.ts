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
