# EditFrame

프레임워크 없이 쓰는 CodeMirror 6 기반 **라이브 프리뷰 마크다운 편집기**입니다.
마크다운 원문을 그대로 저장하고, 화면에서만 문법 기호를 숨겨 보여 줍니다.

> **English summary.** EditFrame is a framework-free, CodeMirror 6–based live-preview markdown editor.
> The markdown text is the source of truth: only decorations change, so a document opened and closed
> without edits is returned byte for byte, and edits are minimal (a checkbox toggle changes one character,
> a table cell edit changes only that cell's bytes). It hides syntax for non-technical users (headings,
> bold/italic/underline/strike, task checkboxes, bullets, links and long URLs, GFM tables rendered as real
> tables with editable cells and a row/column menu), turns tables pasted from spreadsheets or web pages
> into GFM, offers a tap-to-open button for links on touch screens, is built around Korean IME safety on
> iOS Safari and Windows Chrome, and takes product-specific inline syntax through presets. Ships as one ESM file with CodeMirror bundled
> (`dist/editframe.mjs`, ~302 KB raw / ~99 KB gzip). MIT.

## 무엇을 하나

- **원문이 정답** — 고치지 않으면 한 바이트도 바뀌지 않습니다. 체크박스는 한 글자, 표 칸은 그 칸의 글자만 바뀝니다.
- **기호 숨기기** — 제목 `#`, 굵게 `**`, 기울임, 밑줄 `<u>`, 취소선, 인라인 코드, 체크박스 `- [ ]`, 말머리표, 인용 `>`,
  가로줄, 링크 `[글](주소)`, 긴 맨 주소(짧게 표시). 커서가 닿은 요소만 원문이 드러납니다.
- **표** — GFM 표를 진짜 표로 보여 주고, 칸을 누르면 그 자리에서 고칩니다(Tab·Enter 로 칸 이동, 마지막 칸에서 행 추가).
  칸을 고치는 동안 칸 모서리에 ⋯ 단추 하나가 떠서 줄·열을 넣고 지웁니다(Ctrl/⌘+Enter: 아래에 줄). 줄을 고치면 그 줄만,
  열을 고치면 줄마다 그 칸만 바뀝니다(여백·정렬 `:---:`·`\|` 그대로).
- **표 붙여 넣기** — 엑셀·Numbers·구글 시트·웹 페이지의 표를 붙이면 GFM 표가 됩니다(병합 칸은 값을 줄마다 적어 풂).
- **한글 입력 안전장치** — 글자를 입력하는 동안에는 화면 장식을 다시 그리지 않습니다(조합 이벤트가 없는 iOS 경로 포함).
  자세한 규칙은 [CLAUDE.md](CLAUDE.md) 「iOS IME」.
- **프리셋** — 제품 전용 문법은 코어 밖에 둡니다. 예: `worknotePreset()` 은 `[[제목|uuid]]` 를 칩으로,
  `<!-- wn-op:… -->` 를 항상 숨김으로 처리합니다.

## 완성 기준

이 일곱 가지가 지켜지면 완성으로 봅니다. 각 기준은 지키는 시험이 있습니다.

| # | 기준 | 지키는 시험 |
| --- | --- | --- |
| 1 | 아이폰·PC 에서 한글 입력이 깨지지 않는다 | `test/ime-guard.test.js`, `node scripts/replay-traces.mjs`(traces 재생). 실기기 확인 11/10 통과 |
| 2 | 열고 닫으면 원문이 한 바이트도 바뀌지 않는다 | `test/roundtrip.test.js` |
| 3 | 기호 대신 결과가 보인다(표·체크박스·링크) | `test/marks.test.js`, `replay-traces.mjs` 의 시험대 점검(`rawSyntaxVisible=[]`) |
| 4 | 표의 줄·열을 넣고 지울 수 있다 | `test/table-model.test.js`, `replay-traces.mjs` 의 표 메뉴 점검(마우스·터치로 6개 항목 모두) |
| 5 | 엑셀·웹에서 표를 붙이면 깨끗한 GFM 표가 된다 | `test/paste.test.js`, `replay-traces.mjs` 의 붙여 넣기 점검(브라우저 DOMParser) |
| 6 | 아이폰에서 되돌리기와 링크 열기가 쉽다 | `test/open-button.test.js`(「열기 ↗」 표시 조건), `replay-traces.mjs`(터치 흉내로 누르기). 세 손가락 되돌리기는 헤드리스로 확인할 수 없어 실기기 점검 목록에 둠 |
| 7 | 긴 글도 끊기지 않는다(측정한 예산 안) | `node scripts/bench.mjs` — 2,000줄 문서에서 장식 다시 계산 중앙값 8ms 미만 |

**긴 글 측정값** (2026-11-10, 이 PC, 헤드리스 Chrome 156, `node scripts/bench.mjs` 네 번, 2,000줄·68,222자·표 22개, 각 60회의 중앙값 / p95 범위)

| 측정 | 중앙값 | p95 |
| --- | ---: | ---: |
| 장식 전체 다시 계산(입력이 멈출 때 한 번, 커서가 기호를 드러낼 때) | 4.9–5.1ms | 5.9–8.2ms |
| 연속 입력 중 글자 하나(장식은 옮기기만 함) | 0.6ms | 0.9–1.2ms |
| 커서 이동으로 기호 드러내기(화면 갱신 포함) | 5.7–6.1ms | 7.1–7.7ms |
| 체크박스 누르기(화면 갱신 포함) | 4.6–5.6ms | 6.7–8.4ms |
| 문서 열기(첫 화면까지) | 42–50ms | — |

예산 안이라 화면에 보이는 범위만 계산하는 최적화는 하지 않았습니다. 4,000줄이면 다시 계산이 중앙값 약 10ms 로 예산을 넘습니다(줄 수에 비례).

**하지 않는 것**

- **병합 셀** — GFM 에 병합 문법이 없습니다. 저장하면 원문이 GFM 이 아니게 되고, 화면에서만 합치면 원문과 화면이 어긋납니다.
  붙여 넣은 표의 병합 칸은 같은 값을 줄마다 적어 풉니다.
- **열 너비 저장** — GFM 에 너비가 없습니다. 열은 늘 내용에 맞춰 늘고 줄어듭니다.
- **색** — 마크다운에 색이 없습니다. 색을 넣으면 HTML 이 섞여 원문이 지저분해집니다.
- **자유 형식 문서 모델** — 원문(마크다운 글자)이 정답이라는 원칙과 맞지 않습니다. 화면 모델을 따로 두면 저장할 때마다 원문을 다시 써야 합니다.

## 쓰는 법

빌드 없는 앱이라면 `dist/editframe.mjs` 한 파일만 복사해 씁니다(CodeMirror 포함).

```js
import { createEditor, worknotePreset } from "./vendor/editframe.mjs";

const editor = createEditor(document.getElementById("editor"), {
  doc: "# 장보기\n- [ ] 우유",
  presets: [worknotePreset({ onOpenNote: (id) => openNote(id) })], // 선택
  onChange: (markdown, { composing }) => save(markdown),             // 저장은 디바운스 권장
  readOnly: false,
});

editor.getDoc();          // 지금 원문
editor.setDoc(text);      // 문서 바꾸기(되돌리기 이력 새로 시작)
editor.setRaw(true);      // 「원문 보기」 — 장식 끄기(편집은 그대로)
editor.setReadOnly(true);
editor.destroy();
```

| 내보내는 것 | 설명 |
| --- | --- |
| `createEditor(parent, options)` | 편집기를 만든다. 옵션: `doc`, `presets`, `onChange(doc, {composing})`, `readOnly`, `raw`, `onLinkClick(info)`, `openButton`, `ariaLabel`, `extensions` |
| `createState(doc, options)` | 같은 구성의 `EditorState` (뷰 없이 — 테스트용, 직접 `EditorView` 를 만드는 앱용) |
| `worknotePreset(options)` | WorkNote 전용 문법 프리셋 |
| `toggleTaskAt(state, pos)` | 그 줄의 체크박스 한 글자를 바꾸는 트랜잭션 스펙 |
| `EditorView`, `EditorState` | 번들에 든 CodeMirror. `extensions` 를 만들 때 이것을 쓴다(사본이 둘이면 깨진다) |
| `VERSION` | 버전 문자열 |

링크는 Ctrl/⌘+클릭(읽기 전용이면 그냥 클릭)으로 엽니다. 그냥 누르면 커서가 놓여 바로 고칠 수 있습니다.
터치 화면에서는 커서가 링크·노트 칩 안에 있을 때 그 끝에 작은 「열기 ↗」 단추가 뜹니다(입력·조합 중에는 뜨지 않음,
원문에는 아무것도 넣지 않음). `openButton: true/false` 로 켜고 끌 수 있고, 기본값은 터치 화면(`pointer: coarse`)에서만 켜짐입니다.

### 프리셋 만들기

```js
const myPreset = {
  name: "tags",
  rules: [{ type: "tag", className: "my-tag", re: /#[\p{L}\d_]+/gu, parts: () => ({ hide: [] }) }],
  alwaysHide: [/<!--\s*private:.*?-->/g],       // 커서가 닿아도 숨김
  onLinkClick: (info) => false,                 // false 를 돌려주면 기본 동작
  extensions: [],                               // 추가 CodeMirror 확장
};
```

`parts(match)` 는 `{ hide: [[a, b], …] }`(매치 시작 기준 위치)와 덧붙일 값(`id`, `href` 등)을 돌려줍니다.

## 크기

`dist/editframe.mjs`: **302.2 KB**(압축 전) / **99.2 KB**(gzip). CodeMirror state·view·commands 포함. (`npm run build` 가 다시 잰다.)

## 개발

```sh
npm install
npm test                         # 단위·왕복(round-trip)·IME 가드·dist 시험
npm run build                    # dist/editframe.mjs 와 크기
node scripts/replay-traces.mjs   # 헤드리스 크롬(CDP): 시험대 로딩, 표 메뉴·「열기 ↗」·붙여 넣기 점검, traces/*.json 재생
node scripts/bench.mjs           # 긴 글(2,000줄) 성능 측정, 예산을 넘으면 실패
npm run serve                    # http://127.0.0.1:5178/lab/  (아이폰: npm run serve -- --host)
```

시험대(`lab/`)는 `dist/editframe.mjs` 를 그대로 불러옵니다 — 사용하는 앱이 받는 것과 같은 것을 시험합니다.
견본 문서 전환(기본 문법, WorkNote 프리셋, 표 편집, 긴 글), 「원문 보기」, 읽기 전용, 원문과 같은지 표시, 아이폰·PC 점검 목록, 「입력 기록」 패널이 있습니다.

### 입력 기록(trace) → 재생 시험 만들기

1. 아이폰에서 시험대를 열고 「입력 기록」을 켠 뒤 문제를 재현합니다.
2. 「기록 복사」로 JSON 을 복사해 보냅니다(형식 `editframe-trace/1`: `setup`, `steps`, `expect`, 원본 `events`).
3. 받은 JSON 을 `traces/이름.json` 으로 저장하고, `steps` 를 확인합니다(원본 `events` 에서 자동으로 뽑은 것이라
   손볼 수 있습니다). `expect` 는 **올바른** 결과로 고칩니다 — 버그를 재현한 기록이면 그때의 결과가 틀린 값입니다.
4. `node scripts/replay-traces.mjs traces/이름.json` 으로 재생합니다. 단계 종류는 스크립트 머리 주석에 있습니다.
5. 기록에는 친 글자가 그대로 들어갑니다. 공개 저장소이므로 올리기 전에 내용을 확인합니다.

### 새로 클론했을 때 커밋 훅

`.git/hooks/` 는 저장소에 들어가지 않습니다. 새로 클론하면 [CLAUDE.md](CLAUDE.md) 의 신원 규칙대로
`git config user.email gahmhg@gmail.com` 을 하고, 작성자 이메일 검사(pre-commit)와 `Co-Authored-By` 차단(commit-msg) 훅을 다시 만듭니다.

## 라이선스

MIT © gahmgi. 번들한 CodeMirror 와 참고한 Atomic Editor 는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
