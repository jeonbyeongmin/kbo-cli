#!/usr/bin/env bun
// fixtures/ 의 캡처본을 한 프레임씩 렌더. 라이브 경기 없을 때 렌더 검증용.
//
// 사용법:
//   bun run scripts/render-fixture.ts                       # fixtures/ 전부
//   bun run scripts/render-fixture.ts <path>                # 단일 파일
//   bun run scripts/render-fixture.ts --status STARTED      # status 오버라이드 (RESULT 캡처로 라이브 화면 테스트)
//   bun run scripts/render-fixture.ts --stale 12            # stale 초 강제
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { normalize } from "../src/api.ts";
import { renderGame } from "../src/render.ts";
import type { GameStatus, ScheduleGame, TextRelayData } from "../src/types.ts";

interface Fixture {
  schedule: ScheduleGame;
  relay: TextRelayData;
  capturedAt: string;
}

const FIXTURES = resolve(import.meta.dir, "..", "fixtures");

async function loadFixtures(paths: string[]): Promise<{ label: string; fx: Fixture }[]> {
  if (paths.length > 0) {
    return Promise.all(
      paths.map(async (p) => ({ label: p, fx: JSON.parse(await readFile(p, "utf8")) as Fixture }))
    );
  }
  let entries: string[];
  try {
    entries = await readdir(FIXTURES);
  } catch {
    console.error("fixtures/ 디렉터리가 없습니다. scripts/snapshot.ts 로 먼저 캡처하세요.");
    process.exit(1);
  }
  const files = entries.filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error("fixtures/ 가 비어있습니다. scripts/snapshot.ts 로 먼저 캡처하세요.");
    process.exit(1);
  }
  return Promise.all(
    files.map(async (f) => ({
      label: f,
      fx: JSON.parse(await readFile(`${FIXTURES}/${f}`, "utf8")) as Fixture,
    }))
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let statusOverride: GameStatus | null = null;
  let staleSec = 0;
  const paths: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--status") statusOverride = argv[++i] as GameStatus;
    else if (a === "--stale") staleSec = Number(argv[++i] ?? 0);
    else if (a === "-h" || a === "--help") {
      console.log("usage: render-fixture.ts [path...] [--status <code>] [--stale <sec>]");
      return;
    } else paths.push(a);
  }

  const fxs = await loadFixtures(paths);
  for (const { label, fx } of fxs) {
    const sched = statusOverride ? { ...fx.schedule, statusCode: statusOverride } : fx.schedule;
    const ng = normalize(sched, fx.relay);
    process.stdout.write(`\n\x1b[2m# ${label}  (captured ${fx.capturedAt})\x1b[22m\n`);
    process.stdout.write(`${renderGame(ng, { staleSec })}\n`);
  }
}

await main();
