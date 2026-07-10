import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalize } from "./api.ts";
import type { ScheduleGame, TextRelayData } from "./types.ts";

interface Fixture {
  schedule: ScheduleGame;
  relay: TextRelayData;
}

async function loadFixture(name: string): Promise<Fixture> {
  const p = resolve(import.meta.dir, "..", "fixtures", name);
  return JSON.parse(await readFile(p, "utf8")) as Fixture;
}

const FX = "20260501HHSS02026.json"; // 한화-삼성, RESULT, PTS 데이터 포함

describe("normalize — 신규 relay 필드 플럼빙", () => {
  test("winRate: 0/0 sentinel 을 건너뛰고 비0 metricOption 채택", async () => {
    const fx = await loadFixture(FX);
    const g = normalize(fx.schedule, fx.relay);
    expect(g.winRate).toEqual({ home: 100, away: 0 });
  });

  test("currentAtBatPitches: 최신 타석 투구가 num 오름차순 + 구종·구속·좌표", async () => {
    const fx = await loadFixture(FX);
    const g = normalize(fx.schedule, fx.relay);
    expect(g.currentAtBatPitches.length).toBeGreaterThanOrEqual(4);
    const first = g.currentAtBatPitches[0]!;
    expect(first.num).toBe(1);
    expect(first.stuff).toBe("슬라이더");
    expect(first.speedKmh).toBe(127);
    expect(first.result).toBe("F");
    // 운동학 z: fixture 1구는 존([1.649, 3.4]) 안 ~2.19ft
    expect(first.z).not.toBeNull();
    expect(first.z!).toBeGreaterThan(1.6);
    expect(first.z!).toBeLessThan(3.4);
    const nums = g.currentAtBatPitches.map((p) => p.num);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });

  test("recentPlays: 투구 텍스트에 구종·구속 병기", async () => {
    const fx = await loadFixture(FX);
    const g = normalize(fx.schedule, fx.relay);
    expect(g.recentPlays.some((p) => / · .+ \d+km\/h$/.test(p))).toBe(true);
  });

  test("lineups: batOrder 1~9 각 1명 (교체 중복은 seqno 최대만)", async () => {
    const fx = await loadFixture(FX);
    const g = normalize(fx.schedule, fx.relay);
    expect(g.lineups).not.toBeNull();
    for (const side of ["home", "away"] as const) {
      const orders = g.lineups![side].map((s) => s.batOrder);
      expect(new Set(orders).size).toBe(orders.length);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    }
  });

  test("라이브 RHEB: schedule rheb 없으면 currentGameState 로 보충", async () => {
    const fx = await loadFixture(FX);
    const sched = { ...fx.schedule, homeTeamRheb: null, awayTeamRheb: null };
    const g = normalize(sched, fx.relay);
    expect(g.homeRheb).not.toBeNull();
    expect(g.homeRheb!.h).toBe(Number(fx.relay.currentGameState.homeHit));
    expect(g.awayRheb!.b).toBe(Number(fx.relay.currentGameState.awayBallFour));
  });

  test("relay null(BEFORE): 신규 필드 기본값", async () => {
    const fx = await loadFixture(FX);
    const g = normalize(fx.schedule, null);
    expect(g.winRate).toBeNull();
    expect(g.currentAtBatPitches).toEqual([]);
    expect(g.lineups).toBeNull();
    expect(g.currentBatterPcode).toBeNull();
  });
});
