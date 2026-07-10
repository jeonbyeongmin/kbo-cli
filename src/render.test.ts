import { describe, expect, test } from "bun:test";
import { compactCountLine, dots, renderGame, visualWidth } from "./render.ts";
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

describe("renderGame 프레임 정사각 (모든 줄 동일 폭)", () => {
  const frameLineWidths = (out: string): number[] =>
    out
      .split("\n")
      .filter((l) => /^[┌│├└]/.test(strip(l)))
      .map(visualWidth);

  const COLS: Record<string, string> = { compact: "72", normal: "96", wide: "140" };

  const scenarios: [string, Partial<NormalizedGame>][] = [
    [
      "STARTED",
      {
        status: "STARTED",
        awayScore: 3,
        homeScore: 12,
        recentPlays: ["a", "b", "c"],
        inningLine: { away: ["0", "3", "0"], home: ["1", "0", "-"] },
      },
    ],
    [
      "RESULT",
      {
        status: "RESULT",
        awayScore: 5,
        homeScore: 4,
        winner: "AWAY",
        homeRheb: { r: 4, h: 8, e: 0, b: 3 },
        awayRheb: { r: 5, h: 9, e: 1, b: 2 },
        inningLine: { away: ["0", "5"], home: ["4", "0"] },
      },
    ],
    ["READY", { status: "READY", stadium: "잠실", weather: "맑음", broadChannel: "MBC" }],
  ];

  for (const [name, overrides] of scenarios) {
    for (const layout of ["compact", "normal", "wide"] as const) {
      test(`${name} · ${layout} — 프레임 줄 폭이 하나로 일치`, () => {
        const prev = process.env.COLUMNS;
        process.env.COLUMNS = COLS[layout];
        try {
          const out = renderGame(makeStarted(overrides), { layout });
          const widths = new Set(frameLineWidths(out));
          expect(widths.size).toBe(1);
        } finally {
          if (prev === undefined) Reflect.deleteProperty(process.env, "COLUMNS");
          else process.env.COLUMNS = prev;
        }
      });
    }
  }

  test("normal STARTED — 점수가 대형 블록 숫자(█)로 렌더", () => {
    const prev = process.env.COLUMNS;
    process.env.COLUMNS = "96";
    try {
      const out = renderGame(makeStarted({ awayScore: 3, homeScore: 1 }), { layout: "normal" });
      expect(out).toContain("█");
    } finally {
      if (prev === undefined) Reflect.deleteProperty(process.env, "COLUMNS");
      else process.env.COLUMNS = prev;
    }
  });
});

describe("renderGame STARTED 카운트 위치", () => {
  test("normal — 브라유 필드 다음 줄에 한 줄 카운트", () => {
    const out = strip(renderGame(makeStarted(), { layout: "normal" }));
    const lines = out.split("\n");
    // 브라유 필드가 존재하고, 그 마지막 줄 바로 다음이 카운트 한 줄.
    const isField = (l: string): boolean => /[⠀-⣿]/.test(l);
    const fieldIdxs = lines.map((l, i) => (isField(l) ? i : -1)).filter((i) => i >= 0);
    expect(fieldIdxs.length).toBeGreaterThan(0);
    const lastField = fieldIdxs[fieldIdxs.length - 1]!;
    expect(lines[lastField + 1]).toMatch(/B .*S .*O /);
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
      if (prevCols === undefined) Reflect.deleteProperty(process.env, "COLUMNS");
      else process.env.COLUMNS = prevCols;
    }
  });

  test("compact — 기존 한 줄 카운트 그대로", () => {
    const out = strip(renderGame(makeStarted(), { layout: "compact" }));
    expect(out).toMatch(/B .*S .*O /);
  });
});

describe("renderGame 모션(anim)", () => {
  const frameLineWidths = (out: string): number[] =>
    out
      .split("\n")
      .filter((l) => /^[┌│├└]/.test(strip(l)))
      .map(visualWidth);

  for (const layout of ["normal", "wide"] as const) {
    test(`${layout} — anim 프레임도 정사각 유지`, () => {
      const prev = process.env.COLUMNS;
      process.env.COLUMNS = layout === "wide" ? "140" : "96";
      try {
        const out = renderGame(
          makeStarted({ bases: { first: true, second: true, third: false } }),
          {
            layout,
            anim: {
              pulse: 0.9,
              flash: { side: "home", level: 0.7 },
              runners: [{ toBase: "second", t: 0.5 }],
            },
          }
        );
        expect(new Set(frameLineWidths(out)).size).toBe(1);
      } finally {
        if (prev === undefined) Reflect.deleteProperty(process.env, "COLUMNS");
        else process.env.COLUMNS = prev;
      }
    });
  }

  test("주자 이동은 t 에 따라 필드 프레임이 달라진다", () => {
    const prev = process.env.COLUMNS;
    process.env.COLUMNS = "96";
    try {
      const g = makeStarted();
      const at = (t: number): string =>
        strip(renderGame(g, { layout: "normal", anim: { runners: [{ toBase: "second", t }] } }));
      // 색이 아니라 브라유 글리프 자체가 이동하므로 strip 후에도 달라야 한다.
      expect(at(0.2)).not.toBe(at(0.9));
    } finally {
      if (prev === undefined) Reflect.deleteProperty(process.env, "COLUMNS");
      else process.env.COLUMNS = prev;
    }
  });
});

describe("renderGame STARTED 최근 플레이 historyOffset", () => {
  const tenPlays = Array.from({ length: 10 }, (_, i) => `p${i}`);

  test("offset 0 이면 ─ 최근 플레이 ─ 헤더 그대로", () => {
    const out = strip(renderGame(makeStarted({ recentPlays: tenPlays }), { layout: "normal" }));
    expect(out).toContain("최근 플레이");
    expect(out).not.toContain("히스토리");
  });

  test("offset > 0 이면 헤더가 ─ 히스토리 ▲N ─ 로 교체", () => {
    const out = strip(
      renderGame(makeStarted({ recentPlays: tenPlays }), {
        layout: "normal",
        historyOffset: 1,
      })
    );
    expect(out).toContain("히스토리");
    expect(out).not.toContain("최근 플레이");
    // total 10, viewport 5, offset 1 → N = 10 - 5 - 1 = 4
    expect(out).toContain("▲4");
  });

  test("normal viewport 5 — offset 1 이면 plays[1..6] 가 보임", () => {
    const out = strip(
      renderGame(makeStarted({ recentPlays: tenPlays }), {
        layout: "normal",
        historyOffset: 1,
      })
    );
    expect(out).toContain("p1");
    expect(out).toContain("p5");
    expect(out).not.toContain("p0");
    expect(out).not.toContain("p6");
  });

  test("wide viewport 7 — offset 0 이면 plays[0..7] 가 보임", () => {
    const prevCols = process.env.COLUMNS;
    process.env.COLUMNS = "140";
    try {
      const out = strip(renderGame(makeStarted({ recentPlays: tenPlays }), { layout: "wide" }));
      expect(out).toContain("p0");
      expect(out).toContain("p6");
      expect(out).not.toContain("p7");
    } finally {
      if (prevCols === undefined) Reflect.deleteProperty(process.env, "COLUMNS");
      else process.env.COLUMNS = prevCols;
    }
  });

  test("compact viewport 3 — offset 2 이면 plays[2..5] 가 보임", () => {
    const out = strip(
      renderGame(makeStarted({ recentPlays: tenPlays }), {
        layout: "compact",
        historyOffset: 2,
      })
    );
    expect(out).toContain("p2");
    expect(out).toContain("p4");
    expect(out).not.toContain("p1");
    expect(out).not.toContain("p5");
  });
});
