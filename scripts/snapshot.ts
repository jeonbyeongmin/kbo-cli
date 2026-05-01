#!/usr/bin/env bun
// Naver 응답을 fixtures/ 에 캡처. 라이브 경기가 없을 때도 렌더 테스트가 가능하도록.
//
// 사용법:
//   bun run scripts/snapshot.ts <gameId>              # 단일 게임 (과거 게임도 가능)
//   bun run scripts/snapshot.ts --date 2026-05-02     # 해당 날짜 전 경기 (today 만 동작)
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchGameBasic, fetchRelay, fetchSchedule } from "../src/api.ts";
import type { ScheduleGame } from "../src/types.ts";

const FIXTURES = resolve(import.meta.dir, "..", "fixtures");

async function snapshot(sched: ScheduleGame): Promise<void> {
  const relay = await fetchRelay(sched.gameId);
  const path = `${FIXTURES}/${sched.gameId}.json`;
  const payload = {
    schedule: sched,
    relay,
    capturedAt: new Date().toISOString(),
  };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `saved ${sched.gameId}.json  ${sched.awayTeamName} ${sched.awayTeamScore} - ${sched.homeTeamScore} ${sched.homeTeamName}  [${sched.statusCode}]`
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("usage: snapshot.ts <gameId> [date]");
    console.error("       snapshot.ts --date <YYYY-MM-DD>");
    process.exit(1);
  }

  await mkdir(FIXTURES, { recursive: true });

  if (argv[0] === "--date") {
    const date = argv[1];
    if (!date) {
      console.error("--date 값 필요");
      process.exit(1);
    }
    const games = await fetchSchedule(date);
    if (games.length === 0) {
      console.error(`${date} 일정 없음`);
      process.exit(1);
    }
    // /schedule/games 응답은 메타가 빈약 (stadium/starter/weather 없음) — 단일 게임 endpoint 로 보강.
    await Promise.all(
      games.map(async (g) => {
        const rich = await fetchGameBasic(g.gameId);
        await snapshot(rich);
      })
    );
  } else {
    // /schedule/games?date= 는 today 만 신뢰할 수 있어, 단일 게임은 /schedule/games/<id> 로 직접 조회.
    const gameId = argv[0]!;
    const sched = await fetchGameBasic(gameId);
    await snapshot(sched);
  }
}

await main();
