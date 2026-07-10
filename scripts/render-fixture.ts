#!/usr/bin/env bun
// fixtures/ 의 캡처본을 한 프레임씩 렌더. 라이브 경기 없을 때 렌더 검증용.
//
// 사용법:
//   bun run scripts/render-fixture.ts                       # fixtures/ 전부
//   bun run scripts/render-fixture.ts <path>                # 단일 파일
//   bun run scripts/render-fixture.ts --status STARTED      # status 오버라이드 (RESULT 캡처로 라이브 화면 테스트)
//   bun run scripts/render-fixture.ts --stale 12            # stale 초 강제
//   bun run scripts/render-fixture.ts --history 2           # historyOffset 강제 (스크롤백 화면 검증)
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { normalize } from "../src/api.ts";
import { type RenderAnim, renderGame } from "../src/render.ts";
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
  let historyOffset = 0;
  // 애니메이션 프레임 강제 (라이브 없이 모션 렌더 검증용).
  const anim: RenderAnim = {};
  const paths: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--status") statusOverride = argv[++i] as GameStatus;
    else if (a === "--stale") staleSec = Number(argv[++i] ?? 0);
    else if (a === "--history") historyOffset = Number(argv[++i] ?? 0);
    else if (a === "--pulse") anim.pulse = Number(argv[++i] ?? 0);
    else if (a === "--flash") {
      // --flash away[:level]  (level 기본 1)
      const [side, lvl] = (argv[++i] ?? "").split(":");
      anim.flash = { side: side as "away" | "home", level: lvl != null ? Number(lvl) : 1 };
    } else if (a === "--runner") {
      // --runner second:0.5  (반복 가능)
      const [toBase, t] = (argv[++i] ?? "").split(":");
      if (!anim.runners) anim.runners = [];
      anim.runners.push({
        toBase: toBase as "first" | "second" | "third" | "home",
        t: t != null ? Number(t) : 1,
      });
    } else if (a === "-h" || a === "--help") {
      console.log(
        "usage: render-fixture.ts [path...] [--status <code>] [--stale <sec>] [--history <offset>] [--pulse <0..1>] [--flash <away|home>[:level]] [--runner <base>:<t>]"
      );
      return;
    } else paths.push(a);
  }

  const hasAnim = anim.pulse != null || anim.flash != null || anim.runners != null;
  const fxs = await loadFixtures(paths);
  for (const { label, fx } of fxs) {
    const sched = statusOverride ? { ...fx.schedule, statusCode: statusOverride } : fx.schedule;
    const ng = normalize(sched, fx.relay);
    process.stdout.write(`\n\x1b[2m# ${label}  (captured ${fx.capturedAt})\x1b[22m\n`);
    process.stdout.write(
      `${renderGame(ng, { staleSec, historyOffset, anim: hasAnim ? anim : undefined })}\n`
    );
  }
}

await main();
