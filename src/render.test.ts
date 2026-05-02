import { describe, expect, test } from "bun:test";
import { compactCountLine, dots, renderGame } from "./render.ts";
import type { NormalizedGame } from "./types.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require \x1b
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string): string => s.replace(ANSI_RE, "");
const identity = (s: string): string => s;

function makeStarted(overrides: Partial<NormalizedGame> = {}): NormalizedGame {
  return {
    gameId: "G1",
    homeTeamName: "LG",
    awayTeamName: "NC",
    homeTeamCode: "LG",
    awayTeamCode: "NC",
    homeScore: 0,
    awayScore: 0,
    inning: 3,
    topBottom: "top",
    ball: 2,
    strike: 1,
    out: 1,
    bases: { first: true, second: false, third: false },
    batterStats: null,
    pitcherStats: null,
    recentPlays: [],
    inningLine: { home: [], away: [] },
    status: "STARTED",
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

describe("dots", () => {
  test("filled 만큼 ● 채우고 나머지는 ○", () => {
    expect(strip(dots(2, 3, identity))).toBe("●●○");
    expect(strip(dots(0, 2, identity))).toBe("○○");
    expect(strip(dots(3, 3, identity))).toBe("●●●");
  });
});

describe("compactCountLine", () => {
  test("B/S/O 라벨이 한 줄에 모두 포함", () => {
    const out = strip(compactCountLine(2, 1, 1));
    expect(out).toContain("B");
    expect(out).toContain("S");
    expect(out).toContain("O");
    expect(out).not.toContain("\n");
  });
});

describe("renderGame STARTED 카운트 위치", () => {
  test("normal — 다이아몬드 다음 줄에 한 줄 카운트", () => {
    const out = strip(renderGame(makeStarted(), { layout: "normal" }));
    const lines = out.split("\n");
    const diamondIdx = lines.findIndex((l) => l.includes("⌂"));
    expect(diamondIdx).toBeGreaterThan(-1);
    expect(lines[diamondIdx + 1]).toMatch(/B .*S .*O /);
  });

  test("normal — 옛 5줄 countBlock 패턴 (별도 B/S/O 줄) 등장 X", () => {
    const out = strip(renderGame(makeStarted(), { layout: "normal" }));
    const lines = out.split("\n");
    const bOnlyLines = lines.filter((l) => /^\s*│\s*B\s+[●○]+\s*│?\s*$/.test(l));
    expect(bOnlyLines).toHaveLength(0);
  });

  test("wide — 좌측 컬럼에 카운트 한 줄", () => {
    const prevCols = process.env.COLUMNS;
    process.env.COLUMNS = "140";
    try {
      const out = strip(renderGame(makeStarted(), { layout: "wide" }));
      expect(out).toMatch(/B .*S .*O /);
      // 옛 5줄 패턴 잔존 X
      const lines = out.split("\n");
      const sOnlyLines = lines.filter((l) => /^\s*│?\s*S\s+[●○]+\s*$/.test(l));
      expect(sOnlyLines).toHaveLength(0);
    } finally {
      if (prevCols === undefined) delete process.env.COLUMNS;
      else process.env.COLUMNS = prevCols;
    }
  });

  test("compact — 기존 한 줄 카운트 그대로", () => {
    const out = strip(renderGame(makeStarted(), { layout: "compact" }));
    expect(out).toMatch(/B .*S .*O /);
  });
});
