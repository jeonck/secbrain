// 빌드(scripts/build.mjs)와 브라우저(app.js)가 **함께** 쓰는 토크나이저.
// 색인과 질의가 같은 규칙으로 쪼개져야 하므로 절대 한쪽에만 복사하지 마세요.

// 한글은 띄어쓰기와 조사 때문에 단어 단위 색인이 잘 듣지 않습니다.
//   "비용을" / "비용은" / "비용"  → 단어로 보면 전부 다른 토큰
//   "에이전트 비용" / "에이전트비용" → 띄어쓰기만 달라도 불일치
// 그래서 한글 구간은 **문자 바이그램**으로 쪼갭니다. 조사가 붙어도 앞부분 바이그램이 살아남고,
// 띄어쓰기가 달라도 겹치는 바이그램으로 점수가 붙습니다.
// 라틴/숫자는 반대로 단어 그대로가 정확하므로 토큰 하나로 둡니다.

const HANGUL = /[가-힣]+/g;
const LATIN = /[a-z0-9][a-z0-9'+.#_-]*/g;

export function tokenize(text) {
  const out = [];
  const s = String(text).normalize("NFKC").toLowerCase();

  for (const m of s.matchAll(LATIN)) {
    const t = m[0].replace(/[.'+#_-]+$/, "");
    if (t.length >= 2 || /\d/.test(t)) out.push(t);
  }

  for (const m of s.matchAll(HANGUL)) {
    const run = m[0];
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }

  return out;
}

// 스니펫 하이라이트용 — 원문에서 실제로 찾을 수 있는 형태의 조각.
// 바이그램은 화면에 보여줄 게 못 되므로 원래 구간을 그대로 돌려줍니다.
export function queryRuns(text) {
  const s = String(text).normalize("NFKC").trim();
  const runs = [];
  for (const m of s.matchAll(/[가-힣]+|[A-Za-z0-9][A-Za-z0-9'+.#_-]*/g)) {
    if (m[0].length >= 2) runs.push(m[0]);
  }
  return runs.sort((a, b) => b.length - a.length);
}
