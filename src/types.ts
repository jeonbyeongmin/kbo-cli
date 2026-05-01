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
  pos?: string | null;
  hittype?: string | null;
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
  batterName: string;
  pitcherName: string;
  recentPlays: string[];
  inningLine: { home: string[]; away: string[] };
  status: GameStatus;
  fetchedAt: number;
}
