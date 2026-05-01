# kbo-cli

터미널에서 KBO 경기를 관전하는 standalone TUI CLI. Naver Sports 비공식 게이트웨이를
폴링해 점수·이닝·카운트·주자·최근 플레이를 ANSI 그래픽으로 렌더한다.

## 스택

- **런타임**: Node ≥ 18 (배포 산출물), Bun ≥ 1.0 (개발/빌드)
- **언어**: TypeScript (strict, ESM, target ES2022)
- **번들러**: `bun build --target=node --minify` → 단일 파일 `dist/kbo.js`
- **의존성**: `picocolors` 단 하나. 신규 런타임 의존성 추가는 가급적 피한다.

## 디렉터리

```
src/
  index.ts    # CLI 엔트리, 인자 파싱, 서브커맨드 디스패치
  api.ts      # Naver 게이트웨이 fetch + normalize
  types.ts    # API 응답/내부 타입
  render.ts   # TUI 레이아웃 (다이아몬드, 스코어, 카운트, 너비 계산)
  watch.ts    # 폴링 루프, alt-screen, 키 입력 핸들링
  update.ts   # npm registry 백그라운드 버전 체크, self-update
scripts/
  build.ts          # bun build 래퍼 (shebang 주입, chmod +x)
  snapshot.ts       # Naver 응답을 fixtures/<gameId>.json 으로 캡처
  render-fixture.ts # fixture 를 stdout 한 프레임 렌더 (라이브 없이 화면 검증)
fixtures/           # gitignored — snapshot 결과물
```

## 자주 쓰는 명령

```bash
bun run dev          # = bun run src/index.ts
bun run typecheck    # tsc --noEmit
bun run build        # → dist/kbo.js
bun run check        # biome check --write . (format + 안전한 lint 자동 수정)
bun run check:ci     # biome check . (수정 없이 검사만 — CI/스킬용)
bun run format       # biome format --write .
bun run lint         # biome lint --write .
bun test             # 내장 테스트 러너 (테스트 0개여도 exit 0)

bun run snapshot <gameId>            # 단일 게임 fixture 캡처 (과거 게임도 가능)
bun run snapshot --date YYYY-MM-DD   # 해당 날짜 전 경기 (today 만 안정적)
bun run render:fixture                       # fixtures/ 전부 렌더
bun run render:fixture <path>                # 단일 fixture
bun run render:fixture <path> --status <code>  # 상태 오버라이드 (RESULT 캡처로 STARTED 화면 검증)
bun run render:fixture <path> --stale <sec>    # stale 경고 강제
```

UI/렌더 변경 후에는 화면을 직접 확인하고 끝낸다 — 타입 통과 ≠ 렌더 정상.

- 라이브 경기가 있으면: `bun run dev today`, `bun run dev watch --game <id>`.
- 라이브가 없으면: `bun run snapshot <gameId>` 로 STARTED/RESULT/BEFORE 상태별
  fixture 를 한두 개 캡처해두고 `bun run render:fixture` 로 모드별 한 프레임을
  stdout 에 그려 검증한다. RESULT 캡처에 `--status STARTED` 를 붙이면 라이브
  위젯(다이아몬드/카운트/타자·투수)도 강제로 그려볼 수 있다.

PR 을 올릴 때는 `/pr` 스킬을 쓴다. `/simplify` → biome check → typecheck →
build → bun test 5단계 검증을 통과시킨 뒤 develop 으로 PR 을 만든다.

## 작성 규칙

- 신규 파일 추가보다 기존 파일 수정을 우선.
- 한국어 주석/메시지 OK. 코드 식별자는 영문 유지.
- 외부 입력 경계(API 응답)에서만 검증. 내부 호출은 타입 신뢰.
- API 응답 구조가 어그러질 때를 대비해 `--debug` 로 raw JSON 덤프 가능하게 유지.

## 데이터 소스

- 일정: `GET /schedule/games?upperCategoryId=kbaseball&date=YYYY-MM-DD`
- 라이브: `GET /schedule/games/{gameId}/relay`

비공식 API라 무공지 변경 위험이 있다. 폴링 하한은 1초, 기본 5초 — 더 공격적으로
낮추지 않는다 (README 면책 참조).

## 릴리즈

`/release` 스킬로 자동화. develop 에서 버전 bump → 태그 → main 으로 fast-forward
push → GitHub Actions(`.github/workflows/release.yml`)가 npm publish + GitHub
Release 생성. 수동으로 직접 publish 하지 말 것.

## 커밋 / PR 규칙

**커밋 메시지와 PR 제목·본문은 모두 한국어로 작성한다.**

[Angular 커밋 컨벤션](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md)을
따른다.

```
<type>(<scope>): <한국어 제목>

<선택: 한국어 본문 — 무엇을·왜>

<선택: BREAKING CHANGE / Closes #이슈>
```

### type

| type       | 용도                                                    |
| ---------- | ------------------------------------------------------- |
| `feat`     | 새 기능                                                 |
| `fix`      | 버그 수정                                               |
| `docs`     | 문서만 변경 (README, CLAUDE.md 등)                      |
| `style`    | 포매팅·세미콜론 등 동작에 영향 없는 변경                |
| `refactor` | 동작 변화 없는 구조 개선                                |
| `perf`     | 성능 개선                                               |
| `test`     | 테스트 추가·수정                                        |
| `build`    | 빌드 시스템·번들러·외부 의존성 (bun, tsc, package.json) |
| `ci`       | GitHub Actions 등 CI 설정                               |
| `chore`    | 그 외 잡무 (버전 bump, 보조 스크립트)                   |
| `revert`   | 이전 커밋 되돌리기                                      |

### scope (선택)

`api`, `render`, `watch`, `update`, `cli`, `types`, `build` 등 변경 영역.
모호하면 생략한다.

### 제목

- 한국어, 50자 이내, 마침표 없음.
- "추가한다" 보다 "추가" 형태로 명사·축약형 권장.
- 예:
  - `feat(watch): 진행중 경기 좌우 전환 추가`
  - `fix(api): 응답 success=false 시 에러 처리`
  - `refactor(render): 다이아몬드 너비 계산 분리`
  - `docs: README 면책 조항 보강`
  - `chore: 0.2.1 릴리즈`

### 본문 (선택)

- 제목과 한 줄 띄우고 시작, 한 줄 72자 이내.
- "무엇을" 보다 "왜" 위주.

### PR

- 제목은 커밋 컨벤션 그대로 한국어.
- 본문 예시:
  ```
  ## 요약
  - 변경의 핵심 1~3줄

  ## 테스트
  - [ ] `bun run typecheck`
  - [ ] `bun run dev watch --game <id>` 로 라이브 렌더 확인
  ```
- 머지 전 `bun run typecheck` 와 실제 CLI 동작 확인은 필수.
