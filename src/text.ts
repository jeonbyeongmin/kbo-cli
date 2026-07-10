// 터미널 텍스트 폭/정렬 유틸. ANSI escape 를 무시하고 CJK wide 문자를 2칸으로
// 계산한다. render.ts 와 widgets.ts 가 공유 (순환 import 방지를 위해 분리).

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require \x1b
const ANSI_ESC = /\x1b\[[0-9;]*m/;
export const ANSI_RE = new RegExp(ANSI_ESC.source, "g");

export function visualWidth(s: string): number {
  const stripped = s.replace(ANSI_RE, "");
  let w = 0;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0)!;
    // Wide chars: CJK, etc.
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3041 && cp <= 0x33ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

export function padEnd(s: string, width: number): string {
  const w = visualWidth(s);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
}

export function padStart(s: string, width: number): string {
  const w = visualWidth(s);
  if (w >= width) return s;
  return " ".repeat(width - w) + s;
}

export function centerAlign(s: string, width: number): string {
  const w = visualWidth(s);
  if (w >= width) return s;
  const left = Math.floor((width - w) / 2);
  return " ".repeat(left) + s + " ".repeat(width - w - left);
}

const ANSI_TOKEN_RE = new RegExp(`(${ANSI_ESC.source})|([\\s\\S])`, "g");

export function trimToWidth(s: string, max: number): string {
  if (visualWidth(s) <= max) return s;
  let acc = "";
  let w = 0;
  let m: RegExpExecArray | null;
  ANSI_TOKEN_RE.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex token loop
  while ((m = ANSI_TOKEN_RE.exec(s)) !== null) {
    if (m[1]) {
      acc += m[1];
      continue;
    }
    const ch = m[2]!;
    const cw = visualWidth(ch);
    if (w + cw > max - 1) return `${acc}…`;
    acc += ch;
    w += cw;
  }
  return s;
}
