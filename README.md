# EditFrame

프레임워크 없이 쓰는 CodeMirror 6 기반 **라이브 프리뷰 마크다운 편집기**입니다.
마크다운 원문을 그대로 저장하고, 화면에서만 문법 기호를 숨겨 보여 줍니다.

> **English summary.** EditFrame is a framework-free, CodeMirror 6–based live-preview markdown editor.
> The markdown text is the source of truth: only decorations change, so a document opened and closed
> without edits is returned byte for byte, and edits are minimal (a checkbox toggle changes one character,
> a table cell edit changes only that cell's bytes). It hides syntax for non-technical users (headings,
> bold/italic/underline/strike, task checkboxes, bullets, links and long URLs, GFM tables rendered as real
> tables with editable cells), is built around Korean IME safety on iOS Safari and Windows Chrome, and
> takes product-specific inline syntax through presets. Ships as one ESM file with CodeMirror bundled
> (`dist/editframe.mjs`, ~290 KB raw / ~95 KB gzip). MIT.

## 무엇을 하나

- **원문이 정답** — 고치지 않으면 한 바이트도 바뀌지 않습니다. 체크박스는 한 글자, 표 칸은 그 칸의 글자만 바뀝니다.
- **기호 숨기기** — 제목 `#`, 굵게 `**`, 기울임, 밑줄 `<u>`, 취소선, 인라인 코드, 체크박스 `- [ ]`, 말머리표, 인용 `>`,
  가로줄, 링크 `[글](주소)`, 긴 맨 주소(짧게 표시). 커서가 닿은 요소만 원문이 드러납니다.
- **표** — GFM 표를 진짜 표로 보여 주고, 칸을 누르면 그 자리에서 고칩니다(Tab·Enter 로 칸 이동, 마지막 칸에서 행 추가).
- **한글 입력 안전장치** — 글자를 입력하는 동안에는 화면 장식을 다시 그리지 않습니다(조합 이벤트가 없는 iOS 경로 포함).
  자세한 규칙은 [CLAUDE.md](CLAUDE.md) 「iOS IME」.
- **프리셋** — 제품 전용 문법은 코어 밖에 둡니다. 예: `worknotePreset()` 은 `[[제목|uuid]]` 를 칩으로,
  `<!-- wn-op:… -->` 를 항상 숨김으로 처리합니다.

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
| `createEditor(parent, options)` | 편집기를 만든다. 옵션: `doc`, `presets`, `onChange(doc, {composing})`, `readOnly`, `raw`, `onLinkClick(info)`, `ariaLabel`, `extensions` |
| `createState(doc, options)` | 같은 구성의 `EditorState` (뷰 없이 — 테스트용, 직접 `EditorView` 를 만드는 앱용) |
| `worknotePreset(options)` | WorkNote 전용 문법 프리셋 |
| `toggleTaskAt(state, pos)` | 그 줄의 체크박스 한 글자를 바꾸는 트랜잭션 스펙 |
| `EditorView`, `EditorState` | 번들에 든 CodeMirror. `extensions` 를 만들 때 이것을 쓴다(사본이 둘이면 깨진다) |
| `VERSION` | 버전 문자열 |

링크는 Ctrl/⌘+클릭(읽기 전용이면 그냥 클릭)으로 엽니다. 그냥 누르면 커서가 놓여 바로 고칠 수 있습니다.

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

`dist/editframe.mjs`: **290.3 KB**(압축 전) / **95.1 KB**(gzip). CodeMirror state·view·commands 포함. (`npm run build` 가 다시 잰다.)

## 개발

```sh
npm install
npm test                         # 단위·왕복(round-trip)·IME 가드·dist 시험
npm run build                    # dist/editframe.mjs 와 크기
node scripts/replay-traces.mjs   # 헤드리스 크롬(CDP)으로 시험대 로딩 + traces/*.json 재생
npm run serve                    # http://127.0.0.1:5178/lab/  (아이폰: npm run serve -- --host)
```

시험대(`lab/`)는 `dist/editframe.mjs` 를 그대로 불러옵니다 — 사용하는 앱이 받는 것과 같은 것을 시험합니다.
견본 문서 전환, 「원문 보기」, 읽기 전용, 원문과 같은지 표시, 아이폰·PC 점검 목록, 「입력 기록」 패널이 있습니다.

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
