// Sample documents — shared by the lab page and the round-trip test (test/roundtrip.test.js).
// Public repo: keep every sample neutral (no company, people, HR or other real-world data).

export const BASIC = `# 이번 주 계획

## 할 일
- [ ] 장보기 목록 정리하기
- [x] 도서관에 **책 반납** 하기
- [ ] 운동 일정 <u>금요일까지</u> 정하기
  - [ ] 들여쓴 하위 할 일
    - [x] 두 단계 들여쓴 완료 항목
- [ ]

## 메모
- 09:10 산책하면서 *생각 정리*
- 참고 링크 https://example.com/guide?id=42 확인
- [요리 레시피 모음](https://example.org/recipes) 에서 하나 고르기
- 아주 긴 주소는 줄여 보인다 https://www.example.com/articles/2026/11/very-long-path/to/a/page?ref=newsletter&utm=none
* 별표로 쓴 항목
+ 더하기로 쓴 항목

1. 첫째
2. 둘째
   - 섞인 하위 항목

> 인용문은 왼쪽 선과 함께 보인다.

~~취소한 일정~~ 과 \`인라인 코드\` 도 보인다.

---

| 품목 | 수량 | 메모 |
| :--- | ---: | :---: |
| 사과 | 3 | **제철** |
| 우유 | 1 | 저지방 |
| 달걀 | 10 | [가게](https://example.org/shop) |

\`\`\`
코드 블록 안의 **굵게** 는 그대로 둔다
| 표 | 아님 |
\`\`\`

마지막 줄`;

// WorkNote preset sample: [[Title|uuid]] chips and <!-- wn-op:… --> markers (always hidden).
export const WORKNOTE = `## 오늘의 계획
- [ ] [[독서 메모|0b7c9a52-3f1e-4c2a-9d84-6a1f2e3b4c5d]] 다시 읽기
- [x] 주간 계획 **초안** 쓰기 <!-- wn-op:sample-1 -->
  <!-- wn-op:sample-2 -->

## 기록
- 10:40 [[여행 준비|1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d]] 에 숙소 후보 추가
- 11:05 참고 https://example.com/notes 확인 <!-- wn-op:sample-3 -->

| 요일 | 할 일 |
| --- | --- |
| 월 | [[독서 메모|0b7c9a52-3f1e-4c2a-9d84-6a1f2e3b4c5d]] |
| 화 | 장보기 |
`;

// Edge cases for the round-trip corpus (not shown in the lab).
export const EDGE = [
  "",
  "\n",
  "한 줄",
  "끝에 줄바꿈 없음\n- [ ]",
  "\r\n윈도 줄바꿈\r\n- [ ] 항목\r\n",
  "| 표만 | 있음 |\n|---|---|\n| a | b |",
  "|a|b|\n|-|-|\n|1|2|\n",
  "a | b\n--|--\nc | d",
  "| 짧은 행 | 둘 | 셋 |\n| --- | --- | --- |\n| 하나 |\n",
  "| 이스케이프 \\| 파이프 | 값 |\n| --- | --- |\n| x \\| y | z |",
  "| 표 아님 |\n그냥 줄",
  "```\n| a | b |\n|---|---|\n```",
  "<!-- wn-op:x -->",
  "\t- 탭 들여쓰기\n\t\t- [x] 두 번",
  "**굵게만**",
  "* * *\n- - -\n___",
  " 앞 공백​ 제로폭 문자",
];
