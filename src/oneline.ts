import pc from "picocolors";
import { colorTeam } from "./render.ts";
import type { GameStatus, NormalizedGame, ScheduleGame } from "./types.ts";

// watch 의 STATUS_RANK 와 동일 — STARTED 우선, 같은 등급 안에서 시작 시간 순.
const STATUS_RANK: Partial<Record<GameStatus, number>> = {
  STARTED: 0,
  BEFORE: 1,
  READY: 1,
  SUSPENDED: 2,
  RESULT: 3,
};

function matchesTeam(g: { homeTeamName: string; awayTeamName: string }, name: string): boolean {
  return g.homeTeamName === name || g.awayTeamName === name;
}

export function pickStatusGame(games: ScheduleGame[], team: string): ScheduleGame | null {
  const filtered = games.filter((g) => matchesTeam(g, team) && STATUS_RANK[g.statusCode] != null);
  filtered.sort((a, b) => {
    const ra = STATUS_RANK[a.statusCode] ?? 99;
    const rb = STATUS_RANK[b.statusCode] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.gameDateTime.localeCompare(b.gameDateTime);
  });
  return filtered[0] ?? null;
}

function basesLabel(bases: { first: boolean; second: boolean; third: boolean }): string {
  if (bases.first && bases.second && bases.third) return "만루";
  const parts: string[] = [];
  if (bases.first) parts.push("1");
  if (bases.second) parts.push("2");
  if (bases.third) parts.push("3");
  if (parts.length === 0) return "주자 없음";
  return `${parts.join("·")}루`;
}

function inningLabel(inning: number, topBottom: "top" | "bottom"): string {
  return `${inning}회${topBottom === "top" ? "초" : "말"}`;
}

function gameTime(iso: string): string {
  return iso.slice(11, 16);
}

export function renderOneline(game: NormalizedGame, team: string): string {
  const opponent = game.homeTeamName === team ? game.awayTeamName : game.homeTeamName;
  const myScore = game.homeTeamName === team ? game.homeScore : game.awayScore;
  const oppScore = game.homeTeamName === team ? game.awayScore : game.homeScore;
  const me = colorTeam(team);
  const opp = colorTeam(opponent);

  if (game.status === "BEFORE" || game.status === "READY") {
    return `${me} · 다음 ${gameTime(game.gameDateTime)} vs ${opp}`;
  }
  if (game.status === "CANCEL") {
    return `${me} · 경기 취소 (vs ${opp})`;
  }
  const score = `${me} ${pc.bold(String(myScore))} - ${pc.bold(String(oppScore))} ${opp}`;
  if (game.status === "RESULT") {
    return `${score} · ${pc.dim("종료")}`;
  }
  if (game.status === "SUSPENDED") {
    return `${score} · ${pc.dim(`${game.inning}회 중단`)}`;
  }
  // STARTED
  const inn = inningLabel(game.inning, game.topBottom);
  const out = `${game.out}사`;
  const runners = basesLabel(game.bases);
  const batter = game.batterStats?.name ? ` · 타: ${game.batterStats.name}` : "";
  const pitcher = game.pitcherStats?.name ? ` · 투: ${game.pitcherStats.name}` : "";
  return `${score} · ${inn} ${out} ${runners}${batter}${pitcher}`;
}
