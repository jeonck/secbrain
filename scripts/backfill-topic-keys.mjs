#!/usr/bin/env node
// 일회성 백필: 옛 브리프의 주제 문장 제목/라벨을 interests.md의 키로 치환.
//
// 왜: daily-brief가 "지식 관리 / PKM / 디지털 가든" 같은 주제 문장을 매일 옮겨 적어서
// 브리프 9건이 같은 문장을 담게 됐고, 그 결과 검색이 주제를 다룬 노트를 가려내지 못했습니다.
// 스킬은 이미 고쳤고(키만 쓰도록), 이 스크립트는 이미 쌓인 브리프를 같은 규칙으로 맞춥니다.
//
// 안전장치:
//   - 05-daily/*brief*.md 만 대상
//   - 줄머리의 "## 제목" 과 "**라벨** —" 만 치환. 본문 산문의 같은 표현은 건드리지 않음
//   - 매핑에 없는 형태는 손대지 않고 남은 것을 보고
//   - --write 를 주지 않으면 드라이런
//
// 사용: node scripts/backfill-topic-keys.mjs [--write]

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAILY = path.join(ROOT, "05-daily");
const WRITE = process.argv.includes("--write");

// 주제 문장(그동안 쓰인 모든 변형) -> interests.md 의 키
const KEY = {
  agents: [
    "AI 에이전트 아키텍처 / 멀티 에이전트 오케스트레이션",
    "멀티 에이전트 오케스트레이션",
    "AI 에이전트 아키텍처",
  ],
  anthropic: ["Claude · Anthropic 제품/API 변경사항", "Claude · Anthropic"],
  devtools: [
    "개발자 도구 · CLI · 로컬 우선 소프트웨어",
    "개발자 도구 · 로컬퍼스트",
    "개발자 도구 · CLI",
  ],
  pkm: ["지식 관리 / PKM / 디지털 가든", "지식 관리 · PKM"],
};

// 긴 문장을 먼저 시도해야 짧은 변형이 앞을 잘라먹지 않습니다.
const PAIRS = Object.entries(KEY)
  .flatMap(([key, phrases]) => phrases.map((p) => ({ key, phrase: p })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

const STRUCTURAL = new Set(["확인하지 못한 것", "오늘 하나만 본다면"]);

const files = (await readdir(DAILY)).filter((f) => f.includes("brief") && f.endsWith(".md")).sort();

let changedFiles = 0;
let changedLines = 0;
const leftover = new Map();

for (const file of files) {
  const full = path.join(DAILY, file);
  const before = await readFile(full, "utf8");
  const out = [];
  let hits = 0;

  for (const line of before.split("\n")) {
    // 1) 섹션 제목:  ## <주제 문장>
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading && !STRUCTURAL.has(heading[1])) {
      const m = PAIRS.find((p) => heading[1] === p.phrase);
      if (m) {
        out.push(`## ${m.key}`);
        hits++;
        continue;
      }
      if (!/^[a-z]+$/.test(heading[1])) {
        leftover.set(`## ${heading[1]}`, (leftover.get(`## ${heading[1]}`) || 0) + 1);
      }
    }

    // 2) 확인하지 못한 것의 라벨:  **<주제 문장>** — 본문
    const label = line.match(/^\*\*(.+?)\*\*\s+—(.*)$/);
    if (label) {
      const m = PAIRS.find((p) => label[1] === p.phrase);
      if (m) {
        out.push(`**${m.key}** —${label[2]}`);
        hits++;
        continue;
      }
      if (!/^[a-z]+$/.test(label[1])) {
        leftover.set(`**${label[1]}**`, (leftover.get(`**${label[1]}**`) || 0) + 1);
      }
    }

    out.push(line);
  }

  const after = out.join("\n");
  if (after !== before) {
    changedFiles++;
    changedLines += hits;
    console.log(`  ${file}: ${hits}줄`);
    if (WRITE) await writeFile(full, after);
  }
}

console.log(
  `\n${WRITE ? "적용" : "드라이런"}: 파일 ${changedFiles}/${files.length}개 · 치환 ${changedLines}줄`
);

if (leftover.size) {
  console.log("\n매핑에 없어 그대로 둔 제목/라벨:");
  for (const [k, n] of [...leftover].sort((a, b) => b[1] - a[1])) console.log(`  ${n}회  ${k}`);
}
if (!WRITE) console.log("\n적용하려면: node scripts/backfill-topic-keys.mjs --write");
