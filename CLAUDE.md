# kbo-cli

터미널에서 KBO 경기를 관전하는 standalone TUI CLI. Naver Sports 비공식 게이트웨이를
폴링해 점수·이닝·카운트·주자·최근 플레이를 ANSI 그래픽으로 렌더한다.

서브커맨드·모듈·플래그 구조는 `src/index.ts` 의 `parseArgs`/`printHelp` 와
`package.json` 의 `scripts` 에서 바로 읽을 수 있다. 여기엔 **코드만 봐선 모르는
것**만 적는다.

## 스택

- **런타임**: Node ≥ 18 (배포 산출물), Bun ≥ 1.0 (개발/빌드)
- **언어**: TypeScript (strict, ESM, target ES2022)
- **번들**: `bun build --target=node --minify` → 단일 파일 `dist/kbo.js`
- **의존성**: `picocolors` 단 하나. **신규 런타임 의존성 추가는 피한다.**

## 작성 규칙

- 신규 파일 추가보다 기존 파일 수정을 우선. 요청 범위 밖은 건드리지 않는다.
- 한국어 주석/메시지 OK. 코드 식별자는 영문 유지.
- 검증은 외부 입력 경계(API 응답)에서만. 내부 호출은 타입을 신뢰한다.
- API 구조가 어그러질 때를 대비해 `--debug` 의 raw JSON 덤프 경로를 유지한다.

## 데이터 소스 (비공식 API)

- 일정: `GET /schedule/games?upperCategoryId=kbaseball&date=YYYY-MM-DD`
- 라이브: `GET /schedule/games/{gameId}/relay`
- 통계: `GET /statistics/categories/kbo/seasons/{season}/...`
  — 통계 계열 `categoryId` 는 `kbo`, schedule 계열은 `kbaseball` 로 **다르다**.

무공지 변경 위험이 있는 비공식 게이트웨이다. **폴링 하한은 1초, 기본 5초** — 더
공격적으로 낮추지 않는다 (README 면책 참조).

## 렌더 검증 (필수)

**UI/렌더 변경 후에는 화면을 직접 확인하고 끝낸다 — 타입 통과 ≠ 렌더 정상.**

- 라이브 경기가 있으면: `bun run dev today`, `bun run dev watch --game <id>`.
- 없으면 fixture 로 검증한다:
  - `bun run snapshot <gameId>` 로 상태별(BEFORE/STARTED/RESULT) 한두 개 캡처.
  - `bun run render:fixture [<path>]` 로 한 프레임 stdout 렌더.
  - `bun run watch:fixture` 로 watch TUI 루프(애니메이션/키 입력/리사이즈)까지
    라이브 상태로 확인 — 다른 캡처는 뒤에 `--fixture <path>` 를 붙여 덮어쓴다.
  - `--status STARTED` : RESULT 캡처로 라이브 위젯(다이아몬드/카운트/타자·투수) 강제 렌더.
  - `--stale <sec>` : stale 경고 강제.

## 워크플로

- `/pr` 로 PR, `/release` 로 릴리즈 — 검증·배포 상세 절차는 각 스킬이 정의한다.
  검증 실패는 우회 대상이 아니라 고쳐야 할 버그다.
- 기본 base 브랜치는 `develop`. `--force`/`--no-verify`·수동 npm publish 는
  사람이 명시할 때만 (배포는 `/release` → GitHub Actions).

## 커밋 / PR (한국어 필수)

[Angular 커밋 컨벤션](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md)을
따르되 **커밋·PR 제목·본문 모두 한국어**로 쓴다.

- 형식: `<type>(<scope>): <제목>` — 필요 시 본문(한 줄 띄움)·`BREAKING CHANGE`/`Closes #N`.
- type: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`.
- scope(선택): `api` `render` `watch` `stats` `config` `update` `cli` `types` `build` — 모호하면 생략.
- 제목: 50자 이내, 마침표 없음, "추가한다"보다 "추가" 명사·축약형.
  - `feat(watch): 진행중 경기 좌우 전환 추가`
  - `fix(api): 응답 success=false 시 에러 처리`
- 본문(선택): 72자 이내, "무엇"보다 "왜".
- 머지 전 `bun run typecheck` + 실제 CLI 동작 확인은 필수.
