// watch 화면 위젯 모음 — 전부 "입력 → string[]|string" 순수 함수.
// render.ts 와의 순환 import 를 피하기 위해 색 함수는 파라미터로 받는다.
import pc from "picocolors";
import { padEnd, padStart, trimToWidth, visualWidth } from "./text.ts";
import type { LineupSlot, PitchMark } from "./types.ts";

export interface TeamSide {
  name: string;
  rate: number; // 승리 확률 0~100
  color: (s: string) => string; // 팀 컬러 전경
}

// 승리 확률 분할 바. 두 팀 합이 100% 라 빈 칸 없이 팀 컬러 █ 로 나눈다.
//   한화 11% ████████████████████████████ 89% 삼성
export function winRateBar(away: TeamSide, home: TeamSide, width: number): string {
  const total = away.rate + home.rate;
  if (total <= 0) return "";
  const awayLabel = `${away.name} ${Math.round(away.rate)}%`;
  const homeLabel = `${Math.round(home.rate)}% ${home.name}`;
  const barWidth = Math.max(6, width - visualWidth(awayLabel) - visualWidth(homeLabel) - 2);
  let leftCells = Math.round((away.rate / total) * barWidth);
  // 0% 가 아닌 쪽은 최소 1칸 보장.
  if (away.rate > 0) leftCells = Math.max(1, leftCells);
  if (home.rate > 0) leftCells = Math.min(barWidth - 1, leftCells);
  leftCells = Math.max(0, Math.min(barWidth, leftCells));
  const bar = away.color("█".repeat(leftCells)) + home.color("█".repeat(barWidth - leftCells));
  return `${pc.dim(awayLabel)} ${bar} ${pc.dim(homeLabel)}`;
}

// ─── 스트라이크존 투구 차트 ─────────────────────────────────────
// 현재 타석의 투구 위치를 포수 시점 문자 그리드로. 브라유 대신 문자 그리드를
// 쓰는 이유: 브라유는 셀 단위로만 색을 칠할 수 있어 투구별 색 구분이 안 된다.
// 숫자 글리프 = 몇 구째, 색 = 결과 (볼/스트라이크/파울/타격).

const ZONE_COLS = 13;
const ZONE_ROWS = 7;
const X_MIN = -1.7; // 가로 표시 범위 (ft)
const X_MAX = 1.7;
const ZONE_HALF_X = 0.83; // 존 좌우 경계: 플레이트 반폭 0.708 + 공 반경
const Z_PAD = 0.7; // 존 상하 바깥 여유 (ft) — 7줄 그리드에서 존이 5줄을 차지하도록

// pitchResult 코드 → 색. B볼 / S헛스윙 / T루킹 / F파울 / H타격.
function pitchColor(result: string): (s: string) => string {
  switch (result) {
    case "B":
      return pc.green;
    case "S":
    case "T":
      return (s) => pc.bold(pc.yellow(s));
    case "F":
      return (s) => pc.dim(pc.yellow(s));
    case "H":
      return (s) => pc.bold(pc.cyan(s));
    default:
      return (s) => s;
  }
}

// 차트(7줄) + 우측 투구 리스트(폭이 허용되면)를 반환. 위치 데이터가 하나도
// 없으면 빈 배열 — 섹션 자체가 생략된다.
export function strikeZoneChart(pitches: PitchMark[], width: number): string[] {
  const plottable = pitches.filter((p) => p.x != null && p.z != null);
  if (plottable.length === 0) return [];
  const last = pitches[pitches.length - 1]!;
  const zMax = last.topSz + Z_PAD;
  const zMin = last.bottomSz - Z_PAD;
  const col = (x: number) =>
    Math.max(
      0,
      Math.min(ZONE_COLS - 1, Math.round(((x - X_MIN) / (X_MAX - X_MIN)) * (ZONE_COLS - 1)))
    );
  const row = (z: number) =>
    Math.max(
      0,
      Math.min(ZONE_ROWS - 1, Math.round(((zMax - z) / (zMax - zMin)) * (ZONE_ROWS - 1)))
    );

  const glyphs: string[][] = Array.from({ length: ZONE_ROWS }, () =>
    new Array<string>(ZONE_COLS).fill(" ")
  );
  const colors: ((s: string) => string)[][] = Array.from({ length: ZONE_ROWS }, () =>
    new Array<(s: string) => string>(ZONE_COLS).fill(pc.dim)
  );

  // 바깥 점선 테두리 (존 밖 영역 표시).
  for (let c = 0; c < ZONE_COLS; c++) {
    glyphs[0]![c] = "·";
    glyphs[ZONE_ROWS - 1]![c] = "·";
  }
  for (let r = 0; r < ZONE_ROWS; r++) {
    glyphs[r]![0] = "·";
    glyphs[r]![ZONE_COLS - 1] = "·";
  }

  // 스트라이크존 박스.
  const zl = col(-ZONE_HALF_X);
  const zr = col(ZONE_HALF_X);
  const zt = row(last.topSz);
  const zb = row(last.bottomSz);
  for (let c = zl; c <= zr; c++) {
    glyphs[zt]![c] = "─";
    glyphs[zb]![c] = "─";
  }
  for (let r = zt; r <= zb; r++) {
    glyphs[r]![zl] = "│";
    glyphs[r]![zr] = "│";
  }
  glyphs[zt]![zl] = "┌";
  glyphs[zt]![zr] = "┐";
  glyphs[zb]![zl] = "└";
  glyphs[zb]![zr] = "┘";

  // 투구 플롯 — 같은 셀에 겹치면 + 로 표기.
  for (const p of plottable) {
    const r = row(p.z!);
    const c = col(p.x!);
    const occupied = /[0-9+]/.test(glyphs[r]![c]!);
    glyphs[r]![c] = occupied || p.num > 9 ? "+" : String(p.num);
    colors[r]![c] = pitchColor(p.result);
  }

  const chartRows = glyphs.map((rowArr, r) =>
    rowArr
      .map((g, c) => {
        if (g === " ") return " ";
        return /[0-9+]/.test(g) ? colors[r]![c]!(g) : pc.dim(g);
      })
      .join("")
  );

  const stanceLabel = last.stance === "L" ? " · 좌타" : last.stance === "R" ? " · 우타" : "";
  const header = pc.dim(`─ 투구 위치${stanceLabel} ─`);

  // 우측 투구 리스트: "n 구종 구속 결과". 폭이 모자라면 차트만.
  const listBudget = width - ZONE_COLS - 2;
  const showList = listBudget >= 14;
  const listLines: string[] = showList
    ? pitches.slice(-ZONE_ROWS).map((p) => {
        const c = pitchColor(p.result);
        const speed = p.speedKmh != null ? ` ${p.speedKmh}` : "";
        const body = trimToWidth(`${p.stuff ?? "?"}${speed} ${p.resultText}`, listBudget - 3);
        return `${c(String(p.num).padStart(2))} ${body}`;
      })
    : [];

  const out = [header];
  for (let r = 0; r < ZONE_ROWS; r++) {
    const listPart = listLines[r] ?? "";
    out.push(listPart ? `${chartRows[r]}  ${listPart}` : chartRows[r]!);
  }
  return out;
}

// ─── 타순표 ─────────────────────────────────────────────────────
// 공격팀 타순. 현재 타자는 ▸ + bold + 팀색 하이라이트.
//   ▸3 좌 김태연     .333  1-3
export function lineupRows(
  slots: LineupSlot[],
  currentPcode: string | null,
  highlight: (s: string) => string,
  width: number
): string[] {
  return slots.map((s) => {
    const isCurrent = currentPcode != null && s.pcode === currentPcode;
    const marker = isCurrent ? "▸" : " ";
    const pos = padEnd(s.pos, 2); // 한글 포지션(2칸)과 숫자 포지션(1칸) 정렬
    const name = padEnd(trimToWidth(s.name, 10), 10);
    const avg = padStart(s.todayAvg ?? "-", 5);
    const line = trimToWidth(
      `${marker}${s.batOrder} ${pos} ${name} ${avg}  ${s.hitAb ?? ""}`,
      width
    );
    return isCurrent ? pc.bold(highlight(line)) : line;
  });
}
