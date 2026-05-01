# kbo-cli

<img width="1438" height="1151" alt="스크린샷 2026-05-01 18 27 52" src="https://github.com/user-attachments/assets/1c7737a7-c93a-45ad-abca-997da7306c5d" />



<br/>

터미널에서 KBO 경기를 가볍게 관전하는 standalone TUI CLI.
점수 · 이닝 · 카운트 · 주자 · 최근 플레이를 ANSI 그래픽으로 표시하고
`watch` 모드에서 한 자리에서 갱신된다.

## 설치

```bash
# 일회 실행
npx kbo today
npx kbo watch

# 전역 설치
npm i -g kbo-cli
kbo today
kbo watch
```

요구사항: Node ≥ 18.

## 사용

```bash
kbo                                      # 오늘 경기 목록
kbo today --date 2026-05-01
kbo watch                                # 진행중 경기 라이브
kbo watch --team LG
kbo watch --game 20260501NCLG02026 --interval 3
kbo stats                                # 팀 순위 (←/→ 정렬 전환)
kbo stats batting                        # 타자 리더보드
kbo stats pitching                       # 투수 리더보드
kbo --help
```

## 개발

```bash
git clone https://github.com/jeonbyeongmin/kbo-cli
cd kbo-cli
bun install
bun run dev                              # = bun run src/index.ts
bun run build                            # → dist/kbo.js
```

요구사항: Bun ≥ 1.0 (`curl -fsSL https://bun.sh/install | bash`)

## 라이브/통계 화면 키

| 키       | 동작                                                    |
| -------- | ------------------------------------------------------- |
| `q`      | 종료                                                    |
| `r`      | 즉시 새로고침                                           |
| `←` `→`  | watch: 진행중 경기 전환 · stats: 정렬/카테고리 전환     |
| `Ctrl+C` | 종료                                                    |

## 데이터 소스

Naver Sports 비공식 게이트웨이 (`api-gw.sports.naver.com`):

- 일정: `/schedule/games?upperCategoryId=kbaseball&date=YYYY-MM-DD`
- 라이브: `/schedule/games/{gameId}/relay`
- 시즌: `/statistics/categories/kbo/seasons`
- 순위: `/statistics/categories/kbo/seasons/{seasonCode}/teams`
- 리더보드: `/statistics/categories/kbo/seasons/{seasonCode}/top-players?playerType=HITTER|PITCHER`

비공식이라 무공지 변경 위험이 있다. 응답 구조가 깨지면 `--debug` 와
`watch --debug --game <id>` 로 raw JSON 을 덤프해 비교한다.

## 구조

```
src/
  index.ts    # CLI 엔트리, 인자 파싱
  api.ts      # Naver 게이트웨이 + 정규화
  types.ts    # 응답/내부 타입
  render.ts   # TUI 레이아웃 (다이아몬드, 스코어, 카운트)
  watch.ts    # 폴링 루프 + alt-screen + 키 입력
  stats.ts    # 순위/리더보드 인터랙티브 표
```

의존성은 `picocolors` 단 하나.

## 면책 / Disclaimer

이 프로젝트는 **팬메이드 비공식 도구**이며 KBO, 각 구단, 네이버, 통신사
어디와도 무관합니다.

- 데이터를 비공식 게이트웨이에서 조회하므로 사전 공지 없이 동작이 멈출
  수 있습니다.
- **개인 학습/관전 용도로만 사용하세요.** 상업적 사용/재배포, 데이터
  대량 수집, 2차 서비스 구축은 권장하지 않습니다.
- 표시되는 텍스트 중계 문장은 원 출처(네이버/통신사)의 저작물입니다.
  본 도구는 단순 표시만 합니다.
- 폴링은 기본 5초(하한 1초)로, 모바일 앱과 비슷한 수준의 호출 빈도를
  유지합니다. `--interval` 을 무리하게 낮추지 말아 주세요.
- 권리자 측에서 takedown 요청이 있을 경우 즉시 응합니다.
  이슈로 알려주세요.

## 라이선스

[MIT](./LICENSE)
# kbo-cli
