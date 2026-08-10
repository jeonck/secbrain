#!/usr/bin/env node
// vault(.md) -> dist/ 정적 사이트.
// 입력은 숫자 폴더의 마크다운, 출력은 data/index.json + data/notes/<slug>.json + 복사된 site/.

import { readFile, writeFile, mkdir, readdir, rm, cp, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { tokenize } from "../site/tokenize.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const config = JSON.parse(await readFile(path.join(ROOT, "site.config.json"), "utf8"));
const VAULT_DIRS = Object.keys(config.folders);

/* ---------- frontmatter ---------- */

// 노트 프론트매터에 필요한 만큼의 YAML 부분집합: 스칼라, 인라인 배열, 블록 배열.
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };

  const data = {};
  const lines = m[1].split(/\r?\n/);
  let key = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(unquote(listItem[1]));
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const value = kv[2].trim();

    if (value === "") data[key] = "";
    else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else data[key] = unquote(value);
  }
  return { data, body: m[2] };
}

const unquote = (s) => s.replace(/^["'](.*)["']$/, "$1").trim();

/* ---------- extraction ---------- */

// 코드 블록/인라인 코드를 제외한 본문. 링크·태그·태스크가 코드 예시에서 잡히는 것을 막는다.
function stripCode(body) {
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

function extractWikilinks(body) {
  const out = new Set();
  for (const m of stripCode(body).matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
    const target = m[1].trim();
    if (target) out.add(target);
  }
  return [...out];
}

function extractTags(body, fmTags) {
  const out = new Set((fmTags || []).map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean));
  for (const m of stripCode(body).matchAll(/(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu)) out.add(m[1]);
  return [...out];
}

// Obsidian Tasks 형식: - [ ] 내용 📅 YYYY-MM-DD
function extractTasks(body) {
  const tasks = [];
  for (const line of stripCode(body).split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (!m) continue;
    const text = m[2].trim();
    const due = text.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
    tasks.push({
      done: m[1].toLowerCase() === "x",
      // 대시보드는 평문으로 보여주므로 위키링크·강조 기호를 벗깁니다.
      text: text
        .replace(/📅\s*\d{4}-\d{2}-\d{2}/, "")
        .replace(/\[\[([^\]|#]+)(?:[#|]([^\]]*))?\]\]/g, (_a, t, alias) => (alias || t).trim())
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
      due: due ? due[1] : null,
    });
  }
  return tasks;
}

/* ---------- walk ---------- */

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const slugify = (relPath) => relPath.replace(/\.md$/, "").replace(/[/\\]/g, "~");

/* ---------- collect ---------- */

const notes = [];

for (const dir of VAULT_DIRS) {
  for (const file of await walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const raw = await readFile(file, "utf8");
    const { data, body } = parseFrontmatter(raw);

    // 프론트매터 없는 파일은 건너뛴다 — CLAUDE.md의 규약.
    if (!Object.keys(data).length) {
      console.warn(`  skip (no frontmatter): ${rel}`);
      continue;
    }

    const base = path.basename(rel, ".md");
    const mtime = (await stat(file)).mtime.toISOString().slice(0, 10);
    const tasks = extractTasks(body);

    notes.push({
      slug: slugify(rel),
      base,
      path: rel,
      folder: dir,
      title: data.title || base,
      date: data.date || mtime,
      domain: data.domain || config.folders[dir].domain,
      tags: extractTags(body, data.tags),
      summary: data.summary || "",
      source: data.source || "",
      links: extractWikilinks(body),
      tasks,
      words: body.trim().split(/\s+/).filter(Boolean).length,
      body,
    });
  }
}

notes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title)));

/* ---------- resolve links ---------- */

// wikilink는 확장자 없는 파일명(base)을 가리킨다. base -> slug 로 해석하고,
// 해석되지 않는 링크는 "아직 없는 노트"로 남겨 둔다 (그래프에서 점선 노드).
const byBase = new Map();
for (const n of notes) if (!byBase.has(n.base)) byBase.set(n.base, n.slug);
const bySlug = new Map(notes.map((n) => [n.slug, n]));

const backlinks = new Map(notes.map((n) => [n.slug, []]));
const edges = [];
const missing = new Set();

for (const n of notes) {
  n.resolved = [];
  for (const target of n.links) {
    const slug = byBase.get(target) ?? byBase.get(path.basename(target));
    if (!slug || slug === n.slug) {
      if (!slug) missing.add(target);
      continue;
    }
    n.resolved.push(slug);
    backlinks.get(slug).push(n.slug);
    edges.push({ from: n.slug, to: slug });
  }
}

/* ---------- render ---------- */

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

marked.setOptions({ gfm: true, breaks: false, mangle: false, headerIds: true });

function renderBody(note) {
  // wikilink를 마크다운 링크로 치환한 뒤 마크다운을 렌더한다.
  let src = note.body.replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_all, target, _anchor, alias) => {
    const name = target.trim();
    const label = (alias || name).trim();
    const slug = byBase.get(name) ?? byBase.get(path.basename(name));
    return slug
      ? `[${label}](#/note/${encodeURIComponent(slug)})`
      : `<span class="wikilink-missing" title="아직 없는 노트">${escapeHtml(label)}</span>`;
  });

  // 체크박스를 렌더 가능한 형태로. marked의 task list는 disabled input을 내므로 클래스만 얹는다.
  src = src.replace(/^(\s*[-*]\s+\[[ xX]\]\s+.*)$/gm, (line) =>
    line.replace(/📅\s*(\d{4}-\d{2}-\d{2})/, '<span class="due">📅 $1</span>')
  );

  return marked.parse(src);
}

/* ---------- stats ---------- */

const today = new Date();
const daysAgo = (n) => new Date(today.getTime() - n * 864e5).toISOString().slice(0, 10);
const allTasks = notes.flatMap((n) => n.tasks.map((t) => ({ ...t, note: n.slug, noteTitle: n.title })));

const stats = {
  notes: notes.length,
  words: notes.reduce((a, n) => a + n.words, 0),
  links: edges.length,
  tags: new Set(notes.flatMap((n) => n.tags)).size,
  tasksOpen: allTasks.filter((t) => !t.done).length,
  tasksDone: allTasks.filter((t) => t.done).length,
  last7: notes.filter((n) => n.date >= daysAgo(7)).length,
  last30: notes.filter((n) => n.date >= daysAgo(30)).length,
  orphans: notes.filter((n) => !n.resolved.length && !backlinks.get(n.slug).length).length,
  missingLinks: [...missing].sort(),
  byFolder: Object.fromEntries(
    VAULT_DIRS.map((d) => [d, notes.filter((n) => n.folder === d).length])
  ),
  // 최근 12주 캡처 히트맵용 주간 버킷
  activity: Array.from({ length: 84 }, (_, i) => {
    const day = daysAgo(83 - i);
    return { date: day, count: notes.filter((n) => n.date === day).length };
  }),
};

const tagCounts = {};
for (const n of notes) for (const t of n.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;

/* ---------- write ---------- */

if (existsSync(DIST)) await rm(DIST, { recursive: true });
await mkdir(path.join(DIST, "data", "notes"), { recursive: true });
await cp(path.join(ROOT, "site"), DIST, { recursive: true });

const index = {
  generatedAt: new Date().toISOString(),
  config: {
    title: config.title,
    tagline: config.tagline,
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    folders: config.folders,
  },
  stats,
  tags: Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count })),
  edges,
  tasks: allTasks.filter((t) => !t.done).sort((a, b) => (a.due || "9999") .localeCompare(b.due || "9999")),
  notes: notes.map((n) => ({
    slug: n.slug,
    title: n.title,
    date: n.date,
    domain: n.domain,
    folder: n.folder,
    tags: n.tags,
    summary: n.summary,
    words: n.words,
    tasksOpen: n.tasks.filter((t) => !t.done).length,
    linkCount: n.resolved.length + backlinks.get(n.slug).length,
  })),
};

await writeFile(path.join(DIST, "data", "index.json"), JSON.stringify(index));

/* ---------- BM25 검색 색인 ---------- */

// 별도 파일로 뺍니다. 대시보드 첫 로드에는 필요 없고, 검색창을 처음 열 때만 받습니다.
// 본문을 자르지 않으므로(예전엔 4000자에서 잘렸습니다) 긴 브리프의 뒷부분도 검색됩니다.

const plain = (n) =>
  stripCode(n.body)
    .replace(/^---[\s\S]*?---/, "")
    .replace(/!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*[>|#]+[ \t]*/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// 필드 가중치 — 제목에 있는 말이 본문 한가운데 있는 말보다 중요합니다 (BM25F 흉내).
const FIELD_WEIGHT = { title: 4, tags: 3, summary: 3, body: 1 };

const postings = new Map(); // term -> [[docIndex, weightedTf], ...]
const docLen = [];
const docs = [];

notes.forEach((n, i) => {
  const text = plain(n);
  const tf = new Map();

  const add = (str, weight) => {
    for (const t of tokenize(str)) tf.set(t, (tf.get(t) || 0) + weight);
  };
  add(n.title, FIELD_WEIGHT.title);
  add(n.tags.join(" "), FIELD_WEIGHT.tags);
  add(n.summary, FIELD_WEIGHT.summary);
  add(text, FIELD_WEIGHT.body);

  let len = 0;
  for (const [term, w] of tf) {
    len += w;
    if (!postings.has(term)) postings.set(term, []);
    postings.get(term).push([i, w]);
  }
  docLen.push(len);
  docs.push({ slug: n.slug, title: n.title, domain: n.domain, date: n.date, summary: n.summary, text });
});

const searchIndex = {
  docs,
  docLen,
  avgdl: docLen.length ? docLen.reduce((a, b) => a + b, 0) / docLen.length : 0,
  postings: Object.fromEntries(postings),
};

await writeFile(path.join(DIST, "data", "search.json"), JSON.stringify(searchIndex));

for (const n of notes) {
  await writeFile(
    path.join(DIST, "data", "notes", `${n.slug}.json`),
    JSON.stringify({
      slug: n.slug,
      title: n.title,
      date: n.date,
      domain: n.domain,
      folder: n.folder,
      path: n.path,
      tags: n.tags,
      summary: n.summary,
      source: n.source,
      words: n.words,
      html: renderBody(n),
      tasks: n.tasks,
      links: n.resolved.map((s) => ({ slug: s, title: bySlug.get(s).title })),
      backlinks: backlinks.get(n.slug).map((s) => ({ slug: s, title: bySlug.get(s).title })),
    })
  );
}

// SPA 딥링크 404 폴백 (해시 라우팅이라 보통 필요 없지만, 잘못된 경로도 앱으로 흡수)
await cp(path.join(DIST, "index.html"), path.join(DIST, "404.html"));
await writeFile(path.join(DIST, ".nojekyll"), "");

const kb = (o) => (JSON.stringify(o).length / 1024).toFixed(0);
console.log(
  `built ${notes.length} notes · ${edges.length} links · ${stats.tasksOpen} open tasks · ${index.tags.length} tags`
);
console.log(
  `  index ${kb(index)}KB · search ${kb(searchIndex)}KB (${postings.size} terms, 지연 로드)`
);
if (missing.size) console.log(`  unresolved wikilinks: ${[...missing].join(", ")}`);
