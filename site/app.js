/* secbrain — 정적 SPA. 빌드가 만든 data/*.json 만 읽습니다. 런타임에 LLM을 부르지 않습니다. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TODAY = new Date().toISOString().slice(0, 10);
let DB = null;
const noteCache = new Map();

/* ---------- theme ---------- */

const applyTheme = (t) => {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
};
applyTheme(localStorage.getItem("secbrain-theme") || "auto");

$("#theme-toggle").addEventListener("click", () => {
  const cur = localStorage.getItem("secbrain-theme") || "auto";
  const next = cur === "auto" ? "light" : cur === "light" ? "dark" : "auto";
  localStorage.setItem("secbrain-theme", next);
  applyTheme(next);
  if (location.hash.startsWith("#/graph")) render(); // 캔버스는 CSS 변수를 따라가지 않으므로 다시 그린다
});

/* ---------- helpers ---------- */

const domainClass = (d) => `d-${d}`;
const fmtDate = (d) => d;
const dayDiff = (d) => Math.round((new Date(d + "T00:00:00") - new Date(TODAY + "T00:00:00")) / 864e5);

function dueClass(due) {
  if (!due) return "";
  const n = dayDiff(due);
  return n < 0 ? "overdue" : n <= 3 ? "soon" : "";
}
function dueLabel(due) {
  if (!due) return "";
  const n = dayDiff(due);
  if (n < 0) return `${due} · ${-n}일 지남`;
  if (n === 0) return `${due} · 오늘`;
  if (n <= 7) return `${due} · ${n}일 남음`;
  return due;
}

const ghBase = () => `https://github.com/${DB.config.owner}/${DB.config.repo}`;
const issueUrl = (template, title) =>
  `${ghBase()}/issues/new?template=${encodeURIComponent(template)}&title=${encodeURIComponent(title)}`;

function noteCard(n) {
  return `<a class="card" href="#/note/${encodeURIComponent(n.slug)}">
    <span class="card-top">
      <span class="domain ${domainClass(n.domain)}">${esc(n.domain)}</span>
      <span>${fmtDate(n.date)}</span>
      ${n.tasksOpen ? `<span>· 태스크 ${n.tasksOpen}</span>` : ""}
    </span>
    <h3>${esc(n.title)}</h3>
    ${n.summary ? `<p>${esc(n.summary)}</p>` : ""}
    <span class="card-foot">
      ${n.tags.slice(0, 4).map((t) => `<span class="pill">#${esc(t)}</span>`).join("")}
      ${n.linkCount ? `<span class="pill">↔ ${n.linkCount}</span>` : ""}
    </span>
  </a>`;
}

function taskRow(t) {
  return `<a class="task" href="#/note/${encodeURIComponent(t.note)}">
    <span class="box"></span>
    <span class="body">
      <span>${esc(t.text)}</span>
      <span class="meta">
        ${t.due ? `<span class="due ${dueClass(t.due)}">📅 ${dueLabel(t.due)}</span>` : `<span>기한 없음</span>`}
        <span>${esc(t.noteTitle)}</span>
      </span>
    </span>
  </a>`;
}

/* ---------- views ---------- */

function viewDashboard() {
  const s = DB.stats;
  const recent = DB.notes.slice(0, 6);
  const tasks = DB.tasks.slice(0, 6);
  const maxFolder = Math.max(1, ...Object.values(s.byFolder));
  const maxDay = Math.max(1, ...s.activity.map((a) => a.count));

  const folderBars = Object.entries(DB.config.folders)
    .map(([dir, meta]) => {
      const c = s.byFolder[dir] || 0;
      return `<a class="fold" href="#/notes?folder=${encodeURIComponent(dir)}">
        <span class="name"><i class="dot" style="background:var(--d-${meta.domain})"></i>${esc(meta.label)}</span>
        <span class="track"><span class="fill" style="width:${(c / maxFolder) * 100}%;background:var(--d-${meta.domain})"></span></span>
        <span class="cnt">${c}</span>
      </a>`;
    })
    .join("");

  const heat = s.activity
    .map((a) => {
      const lvl = a.count === 0 ? 0 : a.count >= maxDay * 0.66 ? 3 : a.count >= maxDay * 0.33 ? 2 : 1;
      return `<i data-c="${lvl}" title="${a.date} · 노트 ${a.count}개"></i>`;
    })
    .join("");

  return `
  <div class="page-head">
    <h1>대시보드</h1>
    <p>${esc(DB.config.tagline)}</p>
  </div>

  <div class="stats">
    <div class="stat accent"><div class="n">${s.notes}</div><div class="l">노트</div><div class="sub">${s.words.toLocaleString()} 단어</div></div>
    <div class="stat"><div class="n">${s.last7}</div><div class="l">최근 7일 캡처</div><div class="sub">30일 ${s.last30}개</div></div>
    <div class="stat"><div class="n">${s.tasksOpen}</div><div class="l">열린 태스크</div><div class="sub">완료 ${s.tasksDone}개</div></div>
    <div class="stat"><div class="n">${s.links}</div><div class="l">노트 간 링크</div><div class="sub">고립 노트 ${s.orphans}개</div></div>
    <div class="stat"><div class="n">${s.tags}</div><div class="l">태그</div><div class="sub">미작성 링크 ${s.missingLinks.length}개</div></div>
  </div>

  <div class="section-head"><h2>캡처 리듬</h2><span class="hint">최근 12주</span></div>
  <div class="panel">
    <div class="heat">${heat}</div>
    <div class="heat-legend">적음 <i class="hl" data-c="0"></i><i class="hl" data-c="1"></i><i class="hl" data-c="2"></i><i class="hl" data-c="3"></i> 많음</div>
  </div>

  <div class="two-col" style="margin-top:12px">
    <div class="panel">
      <div class="section-head" style="margin:0 0 12px"><h2>도메인 분포</h2></div>
      <div class="folders">${folderBars}</div>
    </div>
    <div class="panel">
      <div class="section-head" style="margin:0 0 12px"><h2>마감 임박</h2><span class="spacer"></span><a class="more" href="#/tasks">전체</a></div>
      ${tasks.length ? `<div class="tasklist">${tasks.map(taskRow).join("")}</div>` : `<p class="empty-state" style="padding:24px">열린 태스크가 없습니다.</p>`}
    </div>
  </div>

  <div class="section-head"><h2>최근 노트</h2><span class="spacer"></span><a class="more" href="#/notes">전체 ${s.notes}개</a></div>
  ${recent.length ? `<div class="cards">${recent.map(noteCard).join("")}</div>` : emptyVault()}
  `;
}

function emptyVault() {
  return `<div class="empty-state">
    아직 노트가 없습니다. <strong>브레인덤프</strong> 버튼으로 첫 캡처를 던져 보세요.
  </div>`;
}

function viewNotes(params) {
  const folder = params.get("folder");
  const tag = params.get("tag");
  const q = (params.get("q") || "").toLowerCase();

  let list = DB.notes;
  if (folder) list = list.filter((n) => n.folder === folder);
  if (tag) list = list.filter((n) => n.tags.includes(tag));
  if (q) list = list.filter((n) => n.search.includes(q));

  const chips = Object.entries(DB.config.folders)
    .map(
      ([dir, meta]) =>
        `<button class="chip" data-folder="${esc(dir)}" aria-pressed="${folder === dir}">${esc(meta.label)} <span style="opacity:.6">${DB.stats.byFolder[dir] || 0}</span></button>`
    )
    .join("");

  return `
  <div class="page-head">
    <h1>노트</h1>
    <p>${list.length}개 표시 중 ${folder || tag || q ? `· <a href="#/notes" style="color:var(--accent)">필터 해제</a>` : `· 전체 ${DB.notes.length}개`}</p>
  </div>
  <div class="filters">
    <button class="chip" data-folder="" aria-pressed="${!folder}">전체</button>
    ${chips}
    <input id="notes-q" type="search" placeholder="이 목록 안에서 검색…" value="${esc(params.get("q") || "")}">
  </div>
  ${tag ? `<div class="filters"><span class="pill">태그 #${esc(tag)}</span></div>` : ""}
  ${list.length ? `<div class="cards">${list.map(noteCard).join("")}</div>` : `<div class="empty-state">조건에 맞는 노트가 없습니다.</div>`}
  `;
}

function viewTasks() {
  const open = DB.tasks;
  const overdue = open.filter((t) => t.due && dayDiff(t.due) < 0);
  const soon = open.filter((t) => t.due && dayDiff(t.due) >= 0 && dayDiff(t.due) <= 7);
  const later = open.filter((t) => t.due && dayDiff(t.due) > 7);
  const undated = open.filter((t) => !t.due);

  const group = (title, hint, items) =>
    items.length
      ? `<div class="section-head"><h2>${title}</h2><span class="hint">${items.length}개 ${hint}</span></div>
         <div class="tasklist">${items.map(taskRow).join("")}</div>`
      : "";

  return `
  <div class="page-head">
    <h1>태스크</h1>
    <p>노트 본문의 <code>- [ ] … 📅 YYYY-MM-DD</code> 를 모은 것입니다. 체크는 노트를 직접 고쳐야 합니다.</p>
  </div>
  ${open.length ? "" : `<div class="empty-state">열린 태스크가 없습니다.</div>`}
  ${group("지난 기한", "· 다시 볼 것", overdue)}
  ${group("7일 안", "", soon)}
  ${group("그 이후", "", later)}
  ${group("기한 없음", "· 날짜를 정하지 않은 것", undated)}
  `;
}

function viewTags() {
  const max = Math.max(1, ...DB.tags.map((t) => t.count));
  return `
  <div class="page-head"><h1>태그</h1><p>${DB.tags.length}개 · 클릭하면 해당 노트만 봅니다.</p></div>
  <div class="tagcloud">
    ${DB.tags
      .map(
        (t) =>
          `<a href="#/notes?tag=${encodeURIComponent(t.name)}" style="font-size:${13 + (t.count / max) * 5}px">
            <b>#${esc(t.name)}</b><small>${t.count}</small></a>`
      )
      .join("")}
  </div>
  ${
    DB.stats.missingLinks.length
      ? `<div class="section-head"><h2>아직 없는 노트</h2><span class="hint">링크는 걸렸지만 파일이 없는 것 — 다음에 쓸 거리</span></div>
         <div class="tagcloud">${DB.stats.missingLinks.map((m) => `<span class="pill">${esc(m)}</span>`).join("")}</div>`
      : ""
  }
  `;
}

function viewGraph() {
  return `
  <div class="page-head"><h1>그래프</h1><p>노트 ${DB.notes.length}개 · 링크 ${DB.edges.length}개. 드래그로 이동, 휠로 확대, 노드 클릭으로 열기.</p></div>
  <div class="graph-wrap">
    <canvas id="graph"></canvas>
    <div class="graph-hint">고립 노트는 회색입니다</div>
    <div class="graph-legend">
      ${Object.values(DB.config.folders)
        .map((m) => `<span><i style="background:var(--d-${m.domain})"></i>${esc(m.label)}</span>`)
        .join("")}
    </div>
  </div>`;
}

async function viewNote(slug) {
  let n = noteCache.get(slug);
  if (!n) {
    const res = await fetch(`data/notes/${encodeURIComponent(slug)}.json`);
    if (!res.ok) return `<div class="empty-state">노트를 찾을 수 없습니다: ${esc(slug)}</div>`;
    n = await res.json();
    noteCache.set(slug, n);
  }
  const editUrl = `${ghBase()}/edit/${DB.config.branch}/${n.path}`;
  const histUrl = `${ghBase()}/commits/${DB.config.branch}/${n.path}`;

  const linkList = (items, empty) =>
    items.length
      ? `<ul>${items.map((l) => `<li><a href="#/note/${encodeURIComponent(l.slug)}">${esc(l.title)}</a></li>`).join("")}</ul>`
      : `<p class="empty">${empty}</p>`;

  return `
  <a class="back-link" href="#/notes">← 노트 목록</a>
  <div class="reader">
    <article>
      <header class="note-head">
        <span class="domain ${domainClass(n.domain)}">${esc(n.domain)}</span>
        <h1>${esc(n.title)}</h1>
        ${n.summary ? `<p class="note-sum">${esc(n.summary)}</p>` : ""}
        <div class="note-meta">
          <span class="pill">${fmtDate(n.date)}</span>
          <span class="pill">${n.words.toLocaleString()} 단어</span>
          ${n.source ? `<span class="pill">${esc(n.source)}</span>` : ""}
          ${n.tags.map((t) => `<a class="pill tag" href="#/notes?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join("")}
        </div>
      </header>
      <div class="prose">${n.html}</div>
    </article>
    <aside class="aside">
      <div>
        <h4>백링크 ${n.backlinks.length}</h4>
        ${linkList(n.backlinks, "이 노트를 가리키는 노트가 아직 없습니다.")}
      </div>
      <div>
        <h4>바깥 링크 ${n.links.length}</h4>
        ${linkList(n.links, "이 노트에서 나가는 링크가 없습니다.")}
      </div>
      <div>
        <h4>원본</h4>
        <ul>
          <li><a href="${esc(editUrl)}" target="_blank" rel="noopener">GitHub에서 편집 ↗</a></li>
          <li><a href="${esc(histUrl)}" target="_blank" rel="noopener">변경 이력 ↗</a></li>
        </ul>
        <p class="empty" style="margin-top:8px"><code>${esc(n.path)}</code></p>
      </div>
    </aside>
  </div>`;
}

/* ---------- router ---------- */

async function render() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [rawPath, rawQuery] = hash.split("?");
  const parts = rawPath.split("/").filter(Boolean);
  const params = new URLSearchParams(rawQuery || "");
  const main = $("#main");

  let view = "dashboard";
  let html;

  if (parts[0] === "note" && parts[1]) {
    view = "notes";
    html = await viewNote(decodeURIComponent(parts[1]));
  } else if (parts[0] === "notes") {
    view = "notes";
    html = viewNotes(params);
  } else if (parts[0] === "graph") {
    view = "graph";
    html = viewGraph();
  } else if (parts[0] === "tasks") {
    view = "tasks";
    html = viewTasks();
  } else if (parts[0] === "tags") {
    view = "tags";
    html = viewTags();
  } else {
    html = viewDashboard();
  }

  main.innerHTML = html;
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  window.scrollTo(0, 0);

  if (view === "graph") initGraph();

  $$(".chip[data-folder]").forEach((b) =>
    b.addEventListener("click", () => {
      location.hash = b.dataset.folder ? `#/notes?folder=${encodeURIComponent(b.dataset.folder)}` : "#/notes";
    })
  );
  const qi = $("#notes-q");
  if (qi) {
    let t;
    qi.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const p = new URLSearchParams(rawQuery || "");
        qi.value ? p.set("q", qi.value) : p.delete("q");
        const s = p.toString();
        history.replaceState(null, "", `#/notes${s ? "?" + s : ""}`);
        render().then(() => {
          const el = $("#notes-q");
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        });
      }, 180);
    });
  }
}

/* ---------- graph ---------- */

let graphRaf = null;

function initGraph() {
  const canvas = $("#graph");
  if (!canvas) return;
  cancelAnimationFrame(graphRaf);

  const css = getComputedStyle(document.documentElement);
  const colorOf = (d) => css.getPropertyValue(`--d-${d}`).trim() || css.getPropertyValue("--ink-3").trim();
  const lineColor = css.getPropertyValue("--line-strong").trim();
  const inkColor = css.getPropertyValue("--ink-2").trim();
  const orphanColor = css.getPropertyValue("--ink-3").trim();

  const degree = new Map(DB.notes.map((n) => [n.slug, 0]));
  for (const e of DB.edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }

  // 결정론적 초기 배치 — 새로고침마다 그래프가 튀지 않도록 난수 대신 인덱스 기반 원형 배치.
  const nodes = DB.notes.map((n, i) => {
    const a = (i / Math.max(1, DB.notes.length)) * Math.PI * 2;
    const r = 120 + ((i * 37) % 90);
    return {
      slug: n.slug, title: n.title, domain: n.domain,
      deg: degree.get(n.slug) || 0,
      x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0,
    };
  });
  const idx = new Map(nodes.map((n, i) => [n.slug, i]));
  const links = DB.edges
    .map((e) => ({ s: idx.get(e.from), t: idx.get(e.to) }))
    .filter((l) => l.s !== undefined && l.t !== undefined);

  let dpr, W, H;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const view = { x: W / 2, y: H / 2, k: 1 };
  let hover = null, dragNode = null, panning = false, last = null, alpha = 1;

  const radius = (n) => 4.5 + Math.min(9, n.deg * 1.5);

  function step() {
    // 반발 (O(n²) — 개인 vault 규모에서 충분)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = (i - j) * 0.1 || 0.1; dy = 0.1; d2 = 1; }
        if (d2 > 90000) continue;
        const f = 900 / d2;
        const d = Math.sqrt(d2);
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
    // 링크 인력
    for (const l of links) {
      const a = nodes[l.s], b = nodes[l.t];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = (d - 90) * 0.012;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    // 중심 인력 + 감쇠
    for (const n of nodes) {
      if (n === dragNode) { n.vx = n.vy = 0; continue; }
      n.vx -= n.x * 0.004; n.vy -= n.y * 0.004;
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx * alpha; n.y += n.vy * alpha;
    }
    alpha = Math.max(0.06, alpha * 0.994);
  }

  function draw() {
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);

    ctx.lineWidth = 1 / view.k;
    for (const l of links) {
      const a = nodes[l.s], b = nodes[l.t];
      const hot = hover && (hover === a || hover === b);
      ctx.strokeStyle = hot ? colorOf(hover.domain) : lineColor;
      ctx.globalAlpha = hot ? 0.9 : 0.42;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const n of nodes) {
      const r = radius(n);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.deg === 0 ? orphanColor : colorOf(n.domain);
      ctx.globalAlpha = n.deg === 0 ? 0.45 : 1;
      ctx.fill();
      if (hover === n) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2 / view.k;
        ctx.strokeStyle = colorOf(n.domain);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4 / view.k, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (view.k > 0.75 && (n.deg >= 2 || hover === n)) {
        ctx.fillStyle = hover === n ? colorOf(n.domain) : inkColor;
        ctx.font = `${11 / view.k}px ${css.getPropertyValue("--font")}`;
        ctx.textAlign = "center";
        const label = n.title.length > 22 ? n.title.slice(0, 21) + "…" : n.title;
        ctx.fillText(label, n.x, n.y + r + 12 / view.k);
      }
    }
    ctx.restore();
  }

  const toWorld = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - view.x) / view.k,
      y: (ev.clientY - rect.top - view.y) / view.k,
    };
  };
  const pick = (p) => nodes.find((n) => Math.hypot(n.x - p.x, n.y - p.y) < radius(n) + 6);

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = toWorld(e);
    dragNode = pick(p);
    panning = !dragNode;
    last = { x: e.clientX, y: e.clientY };
    alpha = Math.max(alpha, 0.7);
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = toWorld(e);
    if (dragNode) { dragNode.x = p.x; dragNode.y = p.y; alpha = Math.max(alpha, 0.5); }
    else if (panning && last) {
      view.x += e.clientX - last.x;
      view.y += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
    } else {
      const h = pick(p);
      if (h !== hover) { hover = h; canvas.style.cursor = h ? "pointer" : "grab"; }
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (dragNode && last && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 4) {
      location.hash = `#/note/${encodeURIComponent(dragNode.slug)}`;
    }
    dragNode = null; panning = false; last = null;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const k = Math.min(3, Math.max(0.25, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      view.x = mx - ((mx - view.x) / view.k) * k;
      view.y = my - ((my - view.y) / view.k) * k;
      view.k = k;
    },
    { passive: false }
  );

  (function loop() {
    step();
    draw();
    graphRaf = requestAnimationFrame(loop);
  })();

  // 뷰를 떠나면 시뮬레이션 정지
  const stop = () => {
    if (!document.getElementById("graph")) {
      cancelAnimationFrame(graphRaf);
      ro.disconnect();
      window.removeEventListener("hashchange", stop);
    }
  };
  window.addEventListener("hashchange", stop);
}

/* ---------- search palette ---------- */

const palette = $("#palette");
const pInput = $("#palette-input");
const pResults = $("#palette-results");
let pSel = 0, pHits = [];

function openPalette() {
  palette.hidden = false;
  pInput.value = "";
  runSearch("");
  pInput.focus();
}
const closePalette = () => (palette.hidden = true);

function highlight(text, q) {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + esc(text.slice(i + q.length));
}

function runSearch(raw) {
  const q = raw.trim().toLowerCase();
  if (!q) {
    pHits = DB.notes.slice(0, 8);
  } else {
    pHits = DB.notes
      .map((n) => {
        const title = n.title.toLowerCase();
        let score = 0;
        if (title === q) score = 100;
        else if (title.startsWith(q)) score = 60;
        else if (title.includes(q)) score = 40;
        else if (n.tags.some((t) => t.toLowerCase().includes(q))) score = 30;
        else if (n.summary.toLowerCase().includes(q)) score = 20;
        else if (n.search.includes(q)) score = 10;
        return { n, score };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score || (a.n.date < b.n.date ? 1 : -1))
      .slice(0, 12)
      .map((h) => h.n);
  }
  pSel = 0;
  pResults.innerHTML = pHits.length
    ? pHits
        .map(
          (n, i) => `<li class="${i === 0 ? "sel" : ""}"><a href="#/note/${encodeURIComponent(n.slug)}">
        <span class="t"><span class="domain ${domainClass(n.domain)}">${esc(n.domain)}</span>${highlight(n.title, q)}</span>
        ${n.summary ? `<span class="s">${highlight(n.summary, q)}</span>` : ""}
      </a></li>`
        )
        .join("")
    : `<li class="palette-empty">"${esc(raw)}" 에 맞는 노트가 없습니다.</li>`;
}

function moveSel(d) {
  const items = $$("#palette-results li");
  if (!pHits.length) return;
  items[pSel]?.classList.remove("sel");
  pSel = (pSel + d + pHits.length) % pHits.length;
  items[pSel]?.classList.add("sel");
  items[pSel]?.scrollIntoView({ block: "nearest" });
}

pInput.addEventListener("input", () => runSearch(pInput.value));
pInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moveSel(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(-1); }
  else if (e.key === "Enter" && pHits[pSel]) {
    e.preventDefault();
    location.hash = `#/note/${encodeURIComponent(pHits[pSel].slug)}`;
    closePalette();
  }
});
pResults.addEventListener("click", (e) => { if (e.target.closest("a")) closePalette(); });

$("#search-open").addEventListener("click", openPalette);

/* ---------- capture sheet ---------- */

const capture = $("#capture");

const REQUESTS = [
  { ico: "🧠", t: "브레인덤프", d: "엉킨 생각을 그대로 던지면 도메인별로 쪼개 노트로 만듭니다.", tpl: "braindump.yml", title: "브레인덤프" },
  { ico: "📰", t: "데일리 브리프", d: "관심사 기반 뉴스 브리프. 출처와 신뢰도가 항목마다 붙습니다.", tpl: "daily-brief.yml", title: "데일리 브리프 요청" },
  { ico: "🔍", t: "위클리 리뷰", d: "지난 7일 노트를 교차 분석해 놓친 패턴을 찾습니다.", tpl: "weekly-review.yml", title: "위클리 리뷰 요청" },
  { ico: "📦", t: "지식 통합", d: "흩어진 노트를 재사용 가능한 프레임워크로 승격시킵니다.", tpl: "consolidate.yml", title: "지식 통합 요청" },
];

function openCapture() {
  $("#capture-grid").innerHTML = REQUESTS.map(
    (r) => `<a href="${issueUrl(r.tpl, r.title)}" target="_blank" rel="noopener">
      <span class="ico">${r.ico}</span>
      <span><b>${r.t}</b><small>${r.d}</small></span>
    </a>`
  ).join("");
  capture.hidden = false;
}

$("#capture-btn").addEventListener("click", openCapture);

$$("[data-close]").forEach((el) =>
  el.addEventListener("click", () => { closePalette(); capture.hidden = true; })
);

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
  else if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); openPalette(); }
  else if (e.key === "Escape") { closePalette(); capture.hidden = true; }
});

/* ---------- boot ---------- */

(async function boot() {
  try {
    DB = await (await fetch("data/index.json")).json();
  } catch {
    $("#main").innerHTML = `<div class="empty-state">
      데이터를 불러오지 못했습니다. <code>node scripts/build.mjs</code> 로 <code>dist/</code>를 만든 뒤 그 폴더를 서빙해야 합니다.
    </div>`;
    return;
  }

  document.title = DB.config.title;
  $("#brand-title").textContent = DB.config.title;
  $("#brand-tagline").textContent = DB.config.tagline;
  $("#repo-link").href = ghBase();
  $("#build-stamp").textContent = `빌드 ${DB.generatedAt.slice(0, 16).replace("T", " ")} UTC`;

  window.addEventListener("hashchange", render);
  await render();
})();
