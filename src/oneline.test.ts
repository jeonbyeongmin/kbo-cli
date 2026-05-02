import { describe, expect, test } from "bun:test";
import { pickStatusGame, renderOneline } from "./oneline.ts";
import type { NormalizedGame, ScheduleGame } from "./types.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require \x1b
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string): string => s.replace(ANSI_RE, "");

function makeSchedule(overrides: Partial<ScheduleGame> = {}): ScheduleGame {
  return {
    gameId: "G1",
    categoryId: "kbo",
    homeTeamCode: "LG",
    homeTeamName: "LG",
    homeTeamScore: 0,
    awayTeamCode: "NC",
    awayTeamName: "NC",
    awayTeamScore: 0,
    statusCode: "BEFORE",
    statusInfo: "",
    gameDateTime: "2026-05-02T18:30:00",
    cancel: false,
    suspended: false,
    ...overrides,
  };
}

function makeNormalized(overrides: Partial<NormalizedGame> = {}): NormalizedGame {
  return {
    gameId: "G1",
    homeTeamName: "LG",
    awayTeamName: "NC",
    homeTeamCode: "LG",
    awayTeamCode: "NC",
    homeScore: 0,
    awayScore: 0,
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
    status: "BEFORE",
    fetchedAt: 0,
    gameDateTime: "2026-05-02T18:30:00",
    stadium: null,
    weather: null,
    broadChannel: null,
    winner: null,
    homeStarter: null,
    awayStarter: null,
    winPitcher: null,
    losePitcher: null,
    homeRheb: null,
    awayRheb: null,
    ...overrides,
  };
}

describe("pickStatusGame", () => {
  test("팀 매칭 실패 시 null", () => {
    const games = [makeSchedule({ homeTeamName: "두산", awayTeamName: "NC" })];
    expect(pickStatusGame(games, "LG")).toBeNull();
  });

  test("STARTED 가 BEFORE 보다 우선 (더블헤더)", () => {
    const before = makeSchedule({
      gameId: "G1",
      statusCode: "BEFORE",
      gameDateTime: "2026-05-02T13:00:00",
    });
    const started = makeSchedule({
      gameId: "G2",
      statusCode: "STARTED",
      gameDateTime: "2026-05-02T18:30:00",
    });
    expect(pickStatusGame([before, started], "LG")?.gameId).toBe("G2");
  });

  test("CANCEL 은 후보에서 제외", () => {
    const cancelled = makeSchedule({ statusCode: "CANCEL" });
    expect(pickStatusGame([cancelled], "LG")).toBeNull();
  });

  test("같은 등급은 시작 시간 이른 순", () => {
    const a = makeSchedule({
      gameId: "G1",
      statusCode: "BEFORE",
      gameDateTime: "2026-05-02T18:30:00",
    });
    const b = makeSchedule({
      gameId: "G2",
      statusCode: "BEFORE",
      gameDateTime: "2026-05-02T13:00:00",
    });
    expect(pickStatusGame([a, b], "LG")?.gameId).toBe("G2");
  });

  test("STARTED 없으면 BEFORE → SUSPENDED → RESULT 순", () => {
    const result = makeSchedule({ gameId: "R", statusCode: "RESULT" });
    const suspended = makeSchedule({ gameId: "S", statusCode: "SUSPENDED" });
    const before = makeSchedule({ gameId: "B", statusCode: "BEFORE" });
    expect(pickStatusGame([result, suspended, before], "LG")?.gameId).toBe("B");
    expect(pickStatusGame([result, suspended], "LG")?.gameId).toBe("S");
    expect(pickStatusGame([result], "LG")?.gameId).toBe("R");
  });
});

describe("renderOneline", () => {
  test("STARTED — 점수·이닝·아웃·주자·타투수 모두 포함", () => {
    const g = makeNormalized({
      status: "STARTED",
      homeScore: 4,
      awayScore: 2,
      inning: 7,
      topBottom: "bottom",
      out: 1,
      bases: { first: true, second: false, third: true },
      batterStats: {
        name: "오스틴",
        pcode: "p1",
        seasonAvg: null,
        todayAvg: null,
        todayLine: null,
        vsPitcher: null,
      },
      pitcherStats: {
        name: "페디",
        pcode: "p2",
        seasonEra: null,
        todayEra: null,
        todayLine: null,
      },
    });
    const out = strip(renderOneline(g, "LG"));
    expect(out).toContain("4");
    expect(out).toContain("2");
    expect(out).toContain("7회말");
    expect(out).toContain("1사");
    expect(out).toContain("1·3루");
    expect(out).toContain("타: 오스틴");
    expect(out).toContain("투: 페디");
  });

  test("BEFORE — 다음 시작 시간과 상대 팀", () => {
    const g = makeNormalized({ status: "BEFORE", gameDateTime: "2026-05-02T18:30:00" });
    const out = strip(renderOneline(g, "LG"));
    expect(out).toContain("다음 18:30");
    expect(out).toContain("vs");
  });

  test("RESULT — 종료 표기 + 최종 점수", () => {
    const g = makeNormalized({ status: "RESULT", homeScore: 5, awayScore: 4 });
    const out = strip(renderOneline(g, "LG"));
    expect(out).toContain("종료");
    expect(out).toContain("5");
    expect(out).toContain("4");
  });

  test("SUSPENDED — N회 중단", () => {
    const g = makeNormalized({
      status: "SUSPENDED",
      inning: 7,
      homeScore: 3,
      awayScore: 3,
    });
    expect(strip(renderOneline(g, "LG"))).toContain("7회 중단");
  });

  test("주자 만루 / 없음 표기", () => {
    const full = makeNormalized({
      status: "STARTED",
      bases: { first: true, second: true, third: true },
    });
    expect(strip(renderOneline(full, "LG"))).toContain("만루");

    const empty = makeNormalized({
      status: "STARTED",
      bases: { first: false, second: false, third: false },
    });
    expect(strip(renderOneline(empty, "LG"))).toContain("주자 없음");
  });

  test("away 팀이 즐겨찾기일 때 점수 매핑 정상", () => {
    const g = makeNormalized({
      status: "STARTED",
      homeTeamName: "두산",
      awayTeamName: "LG",
      homeScore: 2,
      awayScore: 5,
    });
    const out = strip(renderOneline(g, "LG"));
    // 즐겨찾기 팀이 항상 왼쪽에 — LG 가 두산보다 먼저, 점수도 LG=5 가 먼저.
    expect(out.indexOf("LG")).toBeLessThan(out.indexOf("두산"));
    expect(out.indexOf("5")).toBeLessThan(out.indexOf("2"));
  });
});
