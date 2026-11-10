# 기도수첩 (Prayer Notebook)

기도제목 하나를 노트 한 장으로 관리하는 옵시디언 플러그인입니다. 휴대폰에서 쓰기 좋게 만들었습니다.
목회자 PKM 연구소 · 주명철

## 기능

- **기도수첩 화면** — 기도 중 · 응답 · 전체 탭, 분류 필터, 검색
- **새 기도제목** — 제목, 대상(교인카드 노트와 연결), 분류, 전도대상 표시, 기도 내용
- **기도 모드** — 기도 중인 제목을 한 장씩 크게 보여 주고, 「기도했습니다」를 누르면 횟수와 날짜가 기록됩니다. 휴대폰에서는 밀어서 넘깁니다.
- **응답 기록** — 응답일과 내용을 적으면 응답 탭으로 옮겨지고, 「응답 기록 모음」 노트에 기도 기간·횟수와 함께 쌓입니다(간증·예화 자료).
- **중보기도 목록 넣기** — 기도 중인 제목을 분류별로 커서 위치에 넣습니다(주보·기도회용). 실명을 빼고 넣을 수 있습니다.

## 데이터

기도제목은 설정한 폴더(기본 `기도수첩`)에 마크다운 노트로 저장됩니다. 상태·시작일·기도횟수·응답일 등은 노트 속성(frontmatter)에 들어가므로 Bases나 Dataview로도 모아 볼 수 있습니다. 외부 서버로 아무것도 보내지 않습니다.

```yaml
type: 기도제목
제목: "..."
대상: "[[홍길동]]"
분류: "성도"
전도대상: false
상태: 기도중   # 또는 응답
시작일: 2026-11-10
기도횟수: 3
마지막기도일: 2026-11-12
```

## 설치

커뮤니티 플러그인에서 「Prayer Notebook」을 찾아 설치하거나, 릴리스에서 `main.js`, `manifest.json`, `styles.css`를 받아 `.obsidian/plugins/prayer-notebook/`에 넣으십시오.

---

## English

Prayer Notebook keeps each prayer request as a note and is designed for mobile use. The interface is in Korean.

- List view with *praying / answered / all* tabs, category filter and search
- Prayer mode: go through active requests one card at a time and mark each as prayed (count and date are recorded); swipe on mobile
- Record answers; answered prayers are collected in a single log note with the prayer period and count
- Insert the current intercession list at the cursor (for bulletins or prayer meetings)
- All data stays in your vault as Markdown with frontmatter; nothing is sent anywhere

License: MIT
