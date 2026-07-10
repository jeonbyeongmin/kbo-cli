// watch 화면 위젯 모음 — 전부 "입력 → string[]|string" 순수 함수.
// render.ts 와의 순환 import 를 피하기 위해 색 함수는 파라미터로 받는다.
import pc from "picocolors";
import { visualWidth } from "./text.ts";

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
