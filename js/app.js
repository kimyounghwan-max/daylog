(function () {
  'use strict';
  const S = window.Store;
  const CFG = window.APP_CONFIG || {};

  /* ------------------------------------------------------------------ */
  /* 카테고리 정의                                                        */
  /* ------------------------------------------------------------------ */
  const WORKOUT_TYPES = ['러닝', '웨이트', '요가', '수영', '사이클', '등산', '필라테스', '기타'];
  const CATS = {
    book:    { label: '책',     titleHint: '책 제목', fields: [{ k: 'author', label: '저자' }] },
    movie:   { label: '영화',   titleHint: '영화 제목', fields: [{ k: 'director', label: '감독' }, { k: 'where', label: '본 곳', hint: '극장, 넷플릭스…' }] },
    music:   { label: '음악',   titleHint: '곡이나 앨범 제목', fields: [{ k: 'artist', label: '아티스트' }, { k: 'album', label: '앨범' }] },
    travel:  { label: '여행',   titleHint: '여행 이름', fields: [{ k: 'place', label: '장소' }, { k: 'with', label: '함께한 사람' }] },
    date:    { label: '데이트', titleHint: '그날을 한 줄로', fields: [{ k: 'place', label: '장소' }, { k: 'with', label: '함께한 사람' }] },
    workout: { label: '운동',   titleHint: '비워 두면 자동으로 채워져요', ratingLabel: '컨디션',
               fields: [{ k: 'type', label: '종류', options: WORKOUT_TYPES }, { k: 'minutes', label: '시간(분)', num: true }, { k: 'distance', label: '거리(km)', num: true, step: '0.1' }] },
  };
  const REC_CATS = { book: '책', movie: '영화', music: '음악', hobby: '취미' };
  const CREATOR_FIELD = { book: 'author', movie: 'director', music: 'artist' };
  const WD = ['일', '월', '화', '수', '목', '금', '토'];

  /* ------------------------------------------------------------------ */
  /* 상태                                                                 */
  /* ------------------------------------------------------------------ */
  const state = {
    entries: [],
    session: null,
    view: 'feed',
    filter: { cat: null, date: null, q: '' },
    expanded: new Set(),
    focus: 'all',
    recs: [],
    recsError: '',
    pasteText: '',
    promptFallback: '',
    saved: null,
    editing: null,
    editingFile: null,
    introDone: false,
  };

  /* ------------------------------------------------------------------ */
  /* 유틸                                                                 */
  /* ------------------------------------------------------------------ */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const isOwner = () => !!state.session;
  const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  let toastTimer;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 5000 : 2600);
  }

  function stars(r, cat) {
    if (!r) return '';
    const label = (CATS[cat] && CATS[cat].ratingLabel) || '별점';
    return `<span class="stars" aria-label="${label} 5점 중 ${r}점" title="${label}">${'★'.repeat(r)}<span class="off">${'★'.repeat(5 - r)}</span></span>`;
  }

  function paragraphs(text) {
    return String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');
  }

  function metaLine(e) {
    const m = e.meta || {};
    if (e.category === 'workout') {
      const parts = [m.type, m.minutes ? `${m.minutes}분` : '', m.distance ? `${m.distance}km` : ''].filter(Boolean);
      return parts.map((p) => `<span>${esc(p)}</span>`).join('');
    }
    return (CATS[e.category]?.fields || [])
      .filter((f) => m[f.k])
      .map((f) => `<span><em>${f.label}</em> ${esc(m[f.k])}</span>`)
      .join('');
  }

  /* ------------------------------------------------------------------ */
  /* 시작                                                                 */
  /* ------------------------------------------------------------------ */
  async function init() {
    const title = CFG.SITE_TITLE || '하루의 기록';
    document.title = title;
    $('#brand').textContent = title;

    if (S.mode === 'demo') {
      const b = $('#demo-banner');
      b.hidden = false;
      b.textContent = '데모 모드예요. 기록은 이 브라우저에만 저장돼요. js/config.js에 Supabase 정보를 넣으면 실제 저장소로 바뀝니다.';
    }

    state.session = await S.getSession();
    S.onAuthChange(async (s) => { state.session = s; state.saved = null; await loadEntries(); render(); });

    await loadEntries();
    window.addEventListener('hashchange', route);
    route();
  }

  async function loadEntries() {
    try { state.entries = await S.listEntries(); }
    catch (e) { toast(e.message, true); }
  }

  function route() {
    const v = location.hash.slice(1);
    state.view = ['feed', 'health', 'picks'].includes(v) ? v : 'feed';
    document.querySelectorAll('[data-tab]').forEach((a) => {
      if (a.dataset.tab === state.view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    render();
  }

  function render() {
    renderTop();
    renderHero();
    if (state.view === 'feed') renderFeed();
    if (state.view === 'health') renderHealth();
    if (state.view === 'picks') renderPicks();
    renderFoot();
  }

  function renderTop() {
    $('#top-actions').innerHTML = isOwner()
      ? `<button class="btn primary" data-action="new">기록하기</button>`
      : '';
  }

  function renderFoot() {
    const name = esc(CFG.OWNER_NAME || '나');
    let auth = '';
    if (S.mode !== 'demo') {
      auth = isOwner()
        ? `<button class="link" data-action="logout">로그아웃</button>`
        : `<button class="link" data-action="open-login">주인 로그인</button>`;
    }
    $('#foot').innerHTML = `<span>${name}의 하루들을 모아 두는 곳</span>${auth}`;
  }

  /* ------------------------------------------------------------------ */
  /* 히어로: 올해의 날들                                                  */
  /* ------------------------------------------------------------------ */
  function renderHero() {
    const hero = $('#hero');
    if (state.view !== 'feed') { hero.hidden = true; return; }
    hero.hidden = false;

    const today = new Date();
    const year = today.getFullYear();
    const todayKey = ymd(today);
    const byDate = new Map();
    state.entries.forEach((e) => {
      if (!e.entry_date || !e.entry_date.startsWith(String(year))) return;
      if (!byDate.has(e.entry_date)) byDate.set(e.entry_date, []);
      byDate.get(e.entry_date).push(e);
    });

    // 달마다 따로 블록을 만들어 사이에 여백을 둔다
    let filledIdx = 0;
    let totalCols = 0;
    let monthBlocks = '';
    for (let m = 0; m < 12; m++) {
      const first = new Date(year, m, 1);
      const dim = new Date(year, m + 1, 0).getDate();
      const lead = first.getDay();
      const cols = Math.ceil((lead + dim) / 7);
      totalCols += cols;

      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<span class="day blank" aria-hidden="true"></span>';
      for (let day = 1; day <= dim; day++) {
        const d = new Date(year, m, day);
        const key = ymd(d);
        const list = byDate.get(key);
        if (list) {
          const cats = [...new Set(list.map((e) => e.category))];
          const bg = cats.length === 1
            ? `var(--c-${cats[0]})`
            : `linear-gradient(135deg, var(--c-${cats[0]}) 50%, var(--c-${cats[1]}) 50%)`;
          const label = `${m + 1}월 ${day}일: ${list.map((e) => e.title).join(', ')}`;
          const pressed = state.filter.date === key;
          cells += `<button class="day filled${key === todayKey ? ' today' : ''}" style="background:${bg};--i:${filledIdx++}" data-action="pick-day" data-date="${key}" aria-pressed="${pressed}" title="${esc(label)}" aria-label="${esc(label)}"></button>`;
        } else {
          cells += `<span class="day${d > today ? ' future' : ''}${key === todayKey ? ' today' : ''}" aria-hidden="true"></span>`;
        }
      }
      monthBlocks += `
        <div class="month-block${m === today.getMonth() ? ' current' : ''}">
          <span class="month-label">${m + 1}월</span>
          <div class="days" style="--mcols:${cols}">${cells}</div>
        </div>`;
    }

    const counts = {};
    state.entries.forEach((e) => { counts[e.category] = (counts[e.category] || 0) + 1; });
    const chips = [`<button class="chip" data-action="filter-cat" data-cat="" aria-pressed="${!state.filter.cat}">전체 <b>${state.entries.length}</b></button>`]
      .concat(Object.entries(CATS).map(([k, c]) =>
        `<button class="chip" data-action="filter-cat" data-cat="${k}" aria-pressed="${state.filter.cat === k}" style="--c:var(--c-${k})"><i></i>${c.label} <b>${counts[k] || 0}</b></button>`))
      .join('');

    const todayEmpty = !byDate.has(todayKey);
    hero.innerHTML = `
      <div class="hero-text">
        <h1>${year}년, ${byDate.size}개의 하루를 남겼어요</h1>
        <p class="hero-sub">오늘은 ${today.getMonth() + 1}월 ${today.getDate()}일 ${WD[today.getDay()]}요일${todayEmpty && isOwner() ? ` <button class="link" data-action="new">오늘 기록 남기기</button>` : ''}</p>
      </div>
      <div class="year-scroll" id="year-scroll">
        <div class="year${state.introDone ? '' : ' intro'}" style="--cols:${totalCols}">${monthBlocks}</div>
      </div>
      <div class="chips" role="group" aria-label="종류별로 보기">${chips}</div>`;

    const sc = $('#year-scroll');
    const todayCell = sc.querySelector('.today');
    if (todayCell && sc.scrollWidth > sc.clientWidth) {
      sc.scrollLeft = Math.max(0, todayCell.offsetLeft - sc.clientWidth + 60);
    }
    state.introDone = true;
  }

  /* ------------------------------------------------------------------ */
  /* 피드                                                                 */
  /* ------------------------------------------------------------------ */
  function renderFeed() {
    $('#view').innerHTML = `
      <div class="feed">
        <div class="feed-tools">
          <label class="search"><span class="sr">기록 검색</span>
            <input type="search" id="q" placeholder="제목, 느낀 점, 태그로 찾기" value="${esc(state.filter.q)}">
          </label>
          <div id="active-filter"></div>
        </div>
        <div id="feed-list"></div>
      </div>`;
    renderFeedList();
  }

  function filtered() {
    const f = state.filter;
    const q = f.q.trim().toLowerCase();
    return state.entries.filter((e) => {
      if (e.is_private && !isOwner()) return false;
      if (f.cat && e.category !== f.cat) return false;
      if (f.date && e.entry_date !== f.date) return false;
      if (q) {
        const hay = [e.title, e.content, (e.tags || []).join(' '), Object.values(e.meta || {}).join(' ')].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderFeedList() {
    const af = $('#active-filter');
    if (af) {
      af.innerHTML = state.filter.date
        ? `<button class="chip removable" data-action="clear-date">${parse(state.filter.date).getMonth() + 1}월 ${parse(state.filter.date).getDate()}일만 보는 중 <span aria-hidden="true">✕</span></button>`
        : '';
    }
    const box = $('#feed-list');
    if (!box) return;
    const list = filtered();

    if (!state.entries.length) {
      box.innerHTML = `<div class="empty"><p>아직 기록이 없어요.</p>${isOwner() ? '<button class="btn primary" data-action="new">첫 기록 남기기</button>' : ''}</div>`;
      return;
    }
    if (!list.length) {
      box.innerHTML = `<div class="empty"><p>조건에 맞는 기록이 없어요. 검색어나 필터를 지워 보세요.</p><button class="btn" data-action="reset-filter">필터 지우기</button></div>`;
      return;
    }

    let html = '';
    let month = '';
    list.forEach((e) => {
      const d = parse(e.entry_date);
      const mk = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
      if (mk !== month) { month = mk; html += `<h2 class="month">${mk}</h2>`; }
      html += entryHTML(e, d);
    });
    box.innerHTML = html;
  }

  function entryHTML(e, d) {
    const c = CATS[e.category] || { label: e.category };
    const long = (e.content || '').length > 240 || (e.content || '').split('\n').filter(Boolean).length > 4;
    const open = state.expanded.has(e.id);
    const tags = (e.tags || []).length ? `<p class="tags">${e.tags.map((t) => `<button class="tag" data-action="search-tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</p>` : '';
    const img = e.image_url ? `<img class="entry-img" src="${esc(e.image_url)}" alt="${esc(e.title)} 사진" loading="lazy">` : '';
    const owner = isOwner()
      ? `<p class="entry-actions"><button class="link" data-action="edit" data-id="${esc(e.id)}">고치기</button><button class="link danger" data-action="delete" data-id="${esc(e.id)}">지우기</button></p>`
      : '';
    return `
      <article class="entry" style="--c:var(--c-${e.category})">
        <div class="entry-date"><span class="d">${d.getDate()}</span><span class="w">${WD[d.getDay()]}</span></div>
        <div class="entry-body">
          <p class="entry-cat"><i></i>${c.label}${e.is_private ? '<span class="private">나만 보기</span>' : ''}</p>
          <h3>${esc(e.title)}</h3>
          <p class="entry-meta">${metaLine(e)}${stars(e.rating, e.category)}</p>
          ${img}
          ${e.content ? `<div class="entry-text${long && !open ? ' clamp' : ''}">${paragraphs(e.content)}</div>` : ''}
          ${long ? `<button class="link more" data-action="toggle-more" data-id="${esc(e.id)}">${open ? '접기' : '더 읽기'}</button>` : ''}
          ${tags}
          ${owner}
        </div>
      </article>`;
  }

  /* ------------------------------------------------------------------ */
  /* 운동                                                                 */
  /* ------------------------------------------------------------------ */
  function renderHealth() {
    const ws = state.entries.filter((e) => e.category === 'workout' && (!e.is_private || isOwner()));
    const view = $('#view');
    const head = `<header class="page-head"><h1>운동 기록</h1>${isOwner() ? '<button class="btn" data-action="new" data-cat="workout">운동 기록하기</button>' : ''}</header>`;
    if (!ws.length) {
      view.innerHTML = `<div class="page">${head}<div class="empty"><p>아직 운동 기록이 없어요. 오늘 한 운동부터 남겨 보세요.</p></div></div>`;
      return;
    }

    const now = new Date();
    const thisWeek = startOfWeek(now);
    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      const start = addDays(thisWeek, -7 * i);
      const end = addDays(start, 7);
      const items = ws.filter((e) => { const d = parse(e.entry_date); return d >= start && d < end; });
      weeks.push({ start, items, minutes: items.reduce((a, e) => a + num(e.meta.minutes), 0) });
    }
    const monthKey = ymd(now).slice(0, 7);
    const monthItems = ws.filter((e) => e.entry_date.startsWith(monthKey));
    const monthMin = monthItems.reduce((a, e) => a + num(e.meta.minutes), 0);
    const monthKm = monthItems.reduce((a, e) => a + num(e.meta.distance), 0);

    let streak = 0;
    let wk = weeks[11].items.length ? thisWeek : addDays(thisWeek, -7);
    const hasWeek = (start) => ws.some((e) => { const d = parse(e.entry_date); return d >= start && d < addDays(start, 7); });
    while (hasWeek(wk)) { streak++; wk = addDays(wk, -7); }

    // 주간 막대 차트 (SVG)
    const W = 640, H = 220, padL = 8, padB = 28, padT = 22;
    const max = Math.max(60, ...weeks.map((w) => w.minutes));
    const bw = (W - padL * 2) / weeks.length;
    const bars = weeks.map((w, i) => {
      const h = ((H - padB - padT) * w.minutes) / max;
      const x = padL + i * bw + bw * 0.18;
      const y = H - padB - h;
      const cur = i === weeks.length - 1;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="2" class="${cur ? 'bar cur' : 'bar'}"><title>${w.start.getMonth() + 1}/${w.start.getDate()} 주: ${w.minutes}분</title></rect>`
        + (w.minutes ? `<text x="${(x + bw * 0.32).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="val">${w.minutes}</text>` : '')
        + `<text x="${(x + bw * 0.32).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="lbl">${w.start.getMonth() + 1}/${w.start.getDate()}</text>`;
    }).join('');

    const byType = {};
    weeks.forEach((w) => w.items.forEach((e) => { const t = e.meta.type || '기타'; byType[t] = (byType[t] || 0) + num(e.meta.minutes); }));
    const typeMax = Math.max(1, ...Object.values(byType));
    const typeRows = Object.entries(byType).sort((a, b) => b[1] - a[1])
      .map(([t, m]) => `<li><span class="t">${esc(t)}</span><span class="track"><span style="width:${((m / typeMax) * 100).toFixed(1)}%"></span></span><span class="m">${m}분</span></li>`).join('');

    const recent = ws.slice(0, 10).map((e) => {
      const d = parse(e.entry_date);
      return `<li><span class="rd">${d.getMonth() + 1}/${d.getDate()} ${WD[d.getDay()]}</span><span class="rt">${esc(e.meta.type || '운동')}</span><span class="rm">${e.meta.minutes ? e.meta.minutes + '분' : ''}${e.meta.distance ? ' / ' + e.meta.distance + 'km' : ''}</span><span class="rn">${esc(e.content || '')}</span></li>`;
    }).join('');

    view.innerHTML = `
      <div class="page">
        ${head}
        <dl class="stats">
          <div><dt>이번 주</dt><dd>${weeks[11].items.length}<small>회</small></dd></div>
          <div><dt>이번 달 운동 시간</dt><dd>${monthMin}<small>분</small></dd></div>
          <div><dt>이번 달 거리</dt><dd>${Number(monthKm.toFixed(1))}<small>km</small></dd></div>
          <div><dt>쉬지 않은 주</dt><dd>${streak}<small>주 연속</small></dd></div>
        </dl>
        <section class="panel">
          <h2>최근 12주, 주별 운동 시간(분)</h2>
          <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 12주 주별 운동 시간 막대 그래프">${bars}</svg></div>
        </section>
        <div class="two">
          <section class="panel">
            <h2>종류별 시간 (12주)</h2>
            <ul class="types">${typeRows}</ul>
          </section>
          <section class="panel">
            <h2>최근 운동</h2>
            <ul class="recent">${recent}</ul>
          </section>
        </div>
      </div>`;
    const ch = $('.chart', view);
    if (ch) ch.scrollLeft = ch.scrollWidth;
  }

  /* ------------------------------------------------------------------ */
  /* 추천                                                                 */
  /* ------------------------------------------------------------------ */
  function taste() {
    const visible = state.entries.filter((e) => !e.is_private || isOwner());
    const score = {};
    visible.forEach((e) => (e.tags || []).forEach((t) => { score[t] = (score[t] || 0) + (e.rating || 3); }));
    const tags = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 14);
    const loved = visible.filter((e) => e.rating >= 4 && CREATOR_FIELD[e.category]).slice(0, 6);
    return { tags, loved };
  }

  async function renderPicks() {
    const view = $('#view');
    const t = taste();
    const top = t.tags.length ? t.tags[0][1] : 1;
    const tagCloud = t.tags.length
      ? t.tags.map(([tag, s]) => `<li style="--w:${(0.85 + (s / top) * 0.9).toFixed(2)}">${esc(tag)}</li>`).join('')
      : '<li class="muted">태그를 단 기록이 쌓이면 여기에 취향이 보여요.</li>';
    const loved = t.loved.map((e) =>
      `<li style="--c:var(--c-${e.category})"><i></i><span>${esc(e.title)}</span><small>${esc(e.meta[CREATOR_FIELD[e.category]] || '')}</small></li>`).join('');

    let recPart = '';
    if (!isOwner()) {
      recPart = `<p class="muted">추천은 주인이 로그인했을 때만 받을 수 있어요.</p>`;
    } else {
      const focusChips = Object.entries({ all: '골고루', ...REC_CATS })
        .map(([k, l]) => `<button class="chip" data-action="focus" data-focus="${k}" aria-pressed="${state.focus === k}"${k !== 'all' ? ` style="--c:var(--c-${k})"` : ''}>${k !== 'all' ? '<i></i>' : ''}${l}</button>`).join('');
      let results = '';
      if (state.recsError) results = `<p class="error-text">${esc(state.recsError)}</p>`;
      else if (state.recs.length) results = `<ul class="recs">${state.recs.map((r, i) => recHTML(r, i)).join('')}</ul>`;
      const fallback = state.promptFallback
        ? `<label class="paste-box"><span>복사가 막혀 있어요. 아래 내용을 전부 선택해서(Ctrl+A) 복사해 주세요.</span><textarea id="prompt-fallback" rows="6" readonly>${esc(state.promptFallback)}</textarea></label>`
        : '';
      recPart = `
        <div class="rec-controls">
          <div class="chips" role="group" aria-label="무엇을 추천받을까요">${focusChips}</div>
        </div>
        <ol class="rec-steps">
          <li><button class="btn primary" data-action="copy-prompt">추천 요청 복사하기</button> 내 기록과 취향이 담긴 요청문이 복사돼요.</li>
          <li><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">claude.ai 열기</a> 새 채팅에 붙여 넣고(Ctrl+V) 보내요.</li>
          <li>Claude의 답변을 통째로 복사해서 아래 칸에 붙여 넣어요. 추천이 카드로 정리돼요.</li>
        </ol>
        ${fallback}
        <label class="paste-box"><span class="sr">Claude 답변 붙여넣기</span>
          <textarea id="paste-recs" rows="5" placeholder="Claude의 답변을 여기에 붙여 넣으세요">${esc(state.pasteText)}</textarea>
        </label>
        <p><button class="btn" data-action="parse-recs">추천 카드로 정리하기</button></p>
        ${results}
        <section class="saved">
          <h2>담아둔 것</h2>
          <div id="saved-list">${savedHTML()}</div>
        </section>`;
    }

    view.innerHTML = `
      <div class="page">
        <header class="page-head"><h1>새로운 것 추천받기</h1></header>
        <p class="lede">아래 취향은 지금까지 남긴 기록의 태그와 별점으로 계산했어요. 추천은 이 기록을 claude.ai 채팅에 보내서 받아요. 별도 요금 없이 쓰고 있는 Claude 계정으로 동작해요.</p>
        <div class="two taste">
          <section class="panel"><h2>자주 쓴 태그</h2><ul class="cloud">${tagCloud}</ul></section>
          <section class="panel"><h2>별점 4점 이상</h2><ul class="loved">${loved || '<li class="muted">별점을 매긴 책, 영화, 음악이 아직 없어요.</li>'}</ul></section>
        </div>
        ${recPart}
      </div>`;

    if (isOwner() && state.saved === null) {
      try { state.saved = await S.listSaved(); }
      catch (e) { state.saved = []; toast(e.message, true); }
      const box = $('#saved-list');
      if (box) box.innerHTML = savedHTML();
    }
  }

  function buildPrompt(focus) {
    const records = state.entries.slice(0, 120).map((e) => ({
      종류: (CATS[e.category] && CATS[e.category].label) || e.category,
      제목: e.title,
      날짜: e.entry_date,
      별점: e.rating,
      태그: e.tags,
      정보: e.meta,
      느낀점: (e.content || '').slice(0, 220),
    }));
    const exclude = [...new Set([...state.entries.map((e) => e.title), ...(state.saved || []).map((r) => r.title)])];
    const count = focus === 'all' ? '책, 영화, 음악, 취미를 각각 2개씩 모두 8개' : `${REC_CATS[focus]}만 5개`;
    return [
      '아래는 내가 개인 홈페이지에 남긴 기록이야 (책, 영화, 음악, 여행, 데이트, 운동).',
      '',
      JSON.stringify(records),
      '',
      `이 기록으로 내 취향을 파악해서, 아직 경험하지 않은 ${count}를 추천해 줘.`,
      '',
      '규칙:',
      '- 실제로 존재하는 작품만 추천해. 확실하지 않으면 빼.',
      `- 이미 경험한 것은 제외해: ${JSON.stringify(exclude)}`,
      '- 별점이 높은 기록, 자주 쓴 태그, 느낀 점의 결을 근거로 골라.',
      '- 익숙한 취향을 이어가는 것과 조금 새로운 방향으로 넓혀 주는 것을 섞어.',
      '- 취미는 여행, 데이트, 운동 기록에서 보이는 생활 패턴을 반영해서 현실적으로 시작할 수 있는 것으로.',
      '- reason 은 내 기록 중 무엇과 어떻게 이어지는지 구체적으로, 한국어 2문장 이내.',
      '',
      '답변 형식: 먼저 추천을 읽기 편하게 짧게 소개해 주고, 맨 마지막에 아래 형식의 JSON 코드 블록을 꼭 붙여 줘. (내 홈페이지에 붙여 넣을 거야)',
      '{"items":[{"category":"book|movie|music|hobby","title":"제목","creator":"저자/감독/아티스트 (취미는 빈 문자열)","reason":"추천 이유","first_step":"취미일 때 시작하는 방법 한 줄, 아니면 빈 문자열"}]}',
    ].join('\n');
  }

  function parseRecs(text) {
    const clean = String(text || '').replace(/```(?:json)?/g, '');
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('답변에서 추천 목록(JSON)을 찾지 못했어요. 답변 맨 끝의 코드 블록까지 함께 붙여 넣어 주세요.');
    let data;
    try { data = JSON.parse(clean.slice(clean.indexOf('{"items"') >= 0 ? clean.indexOf('{"items"') : start, end + 1)); }
    catch (_) { throw new Error('추천 목록(JSON)을 읽지 못했어요. Claude에게 "JSON 코드 블록만 다시 보여 줘"라고 한 뒤 그 부분을 붙여 넣어 보세요.'); }
    const items = ((data && data.items) || [])
      .filter((i) => i && i.title && REC_CATS[i.category])
      .map((i) => ({ category: i.category, title: String(i.title), creator: String(i.creator || ''), reason: String(i.reason || ''), first_step: String(i.first_step || '') }));
    if (!items.length) throw new Error('읽을 수 있는 추천이 없었어요. category 는 book, movie, music, hobby 중 하나여야 해요.');
    return items;
  }

  function recHTML(r, i) {
    return `
      <li class="rec" style="--c:var(--c-${r.category})">
        <p class="entry-cat"><i></i>${REC_CATS[r.category] || r.category}</p>
        <h3>${esc(r.title)}${r.creator ? ` <small>${esc(r.creator)}</small>` : ''}</h3>
        <p>${esc(r.reason)}</p>
        ${r.first_step ? `<p class="step">시작해 보기: ${esc(r.first_step)}</p>` : ''}
        <p class="rec-actions">
          <button class="btn small" data-action="save-rec" data-i="${i}">담아두기</button>
          <button class="link" data-action="drop-rec" data-i="${i}">관심 없음</button>
        </p>
      </li>`;
  }

  function savedHTML() {
    if (state.saved === null) return '<p class="muted">불러오는 중…</p>';
    if (!state.saved.length) return '<p class="muted">마음에 드는 추천을 담아 두면 여기에 모여요.</p>';
    return `<ul class="saved-list">${state.saved.map((r) => {
      const done = r.status === 'done';
      const canWrite = done && CREATOR_FIELD[r.category];
      return `
        <li class="${done ? 'done' : ''}" style="--c:var(--c-${r.category})">
          <i></i>
          <div><b>${esc(r.title)}</b>${r.creator ? ` <small>${esc(r.creator)}</small>` : ''}${r.note ? `<span class="note">${esc(r.note)}</span>` : ''}</div>
          <span class="saved-actions">
            ${done ? `<button class="link" data-action="rec-undo" data-id="${esc(r.id)}">되돌리기</button>` : `<button class="link" data-action="rec-done" data-id="${esc(r.id)}">해봤어요</button>`}
            ${canWrite ? `<button class="link" data-action="rec-write" data-id="${esc(r.id)}">기록하기</button>` : ''}
            <button class="link danger" data-action="rec-del" data-id="${esc(r.id)}" aria-label="${esc(r.title)} 지우기">지우기</button>
          </span>
        </li>`;
    }).join('')}</ul>`;
  }

  /* ------------------------------------------------------------------ */
  /* 기록 편집기                                                          */
  /* ------------------------------------------------------------------ */
  function openEditor(entry, preset) {
    const base = entry || { category: 'book', entry_date: ymd(new Date()), rating: 0, tags: [], meta: {}, is_private: false, title: '', content: '' };
    state.editing = { ...base, ...(preset || {}), meta: { ...(base.meta || {}), ...((preset && preset.meta) || {}) }, tags: [...(base.tags || [])] };
    state.editingFile = null;
    state.removeImage = false;
    drawEditor();
    $('#editor').showModal();
  }

  function drawEditor() {
    const e = state.editing;
    const c = CATS[e.category];
    const catRadios = Object.entries(CATS).map(([k, v]) =>
      `<label style="--c:var(--c-${k})"><input type="radio" name="category" value="${k}"${e.category === k ? ' checked' : ''}><span>${v.label}</span></label>`).join('');
    const fields = c.fields.map((f) => {
      const val = e.meta[f.k] ?? '';
      if (f.options) {
        return `<label>${f.label}<select name="meta_${f.k}"><option value="">고르기</option>${f.options.map((o) => `<option${o === val ? ' selected' : ''}>${o}</option>`).join('')}</select></label>`;
      }
      return `<label>${f.label}<input name="meta_${f.k}" value="${esc(val)}"${f.num ? ` type="number" min="0" step="${f.step || '1'}" inputmode="decimal"` : ''}${f.hint ? ` placeholder="${esc(f.hint)}"` : ''}></label>`;
    }).join('');
    const r = e.rating || 0;
    const starInputs = [1, 2, 3, 4, 5].map((n) =>
      `<label class="${n <= r ? 'on' : ''}"><input type="radio" name="rating" value="${n}"${n === r ? ' checked' : ''}><span aria-hidden="true">★</span><span class="sr">${n}점</span></label>`).join('');

    let preview = '';
    if (state.editingFile) preview = `<img src="${URL.createObjectURL(state.editingFile)}" alt="고른 사진 미리보기">`;
    else if (e.image_url && !state.removeImage) preview = `<img src="${esc(e.image_url)}" alt="지금 사진"><label class="check"><input type="checkbox" name="remove_image"> 사진 빼기</label>`;

    $('#editor').innerHTML = `
      <form id="entry-form" class="sheet" novalidate>
        <header class="sheet-head">
          <h2>${e.id ? '기록 고치기' : '새 기록'}</h2>
          <button type="button" class="icon" data-action="close-editor" aria-label="닫기">✕</button>
        </header>
        <fieldset class="cat-pick"><legend>무엇을 기록할까요</legend>${catRadios}</fieldset>
        <div class="grid2">
          <label>날짜<input type="date" name="entry_date" value="${esc(e.entry_date)}" required></label>
          <fieldset class="star-pick" style="--c:var(--c-${e.category})"><legend>${c.ratingLabel || '별점'}</legend>${starInputs}<button type="button" class="link" data-action="clear-rating">지우기</button></fieldset>
        </div>
        <label>제목<input name="title" value="${esc(e.title)}" placeholder="${esc(c.titleHint)}"${e.category === 'workout' ? '' : ' required'}></label>
        <div class="grid${c.fields.length > 2 ? '3' : '2'}">${fields}</div>
        <label>느낀 점<textarea name="content" rows="7" placeholder="그때 어떤 기분이었는지, 무엇이 남았는지">${esc(e.content || '')}</textarea></label>
        <label>태그<input name="tags" value="${esc((e.tags || []).join(', '))}" placeholder="쉼표로 나눠 쓰기: 여름, 재즈, 혼자"></label>
        <div class="photo">
          <label>사진<input type="file" name="image" accept="image/*"></label>
          <div class="photo-preview">${preview}</div>
        </div>
        <label class="check"><input type="checkbox" name="is_private"${e.is_private ? ' checked' : ''}> 나만 보기 (방문자에게 보이지 않아요)</label>
        <p class="form-error" id="form-error" role="alert"></p>
        <footer class="sheet-foot">
          <button type="button" class="btn" data-action="close-editor">취소</button>
          <button type="submit" class="btn primary">저장하기</button>
        </footer>
      </form>`;
  }

  function collect(form) {
    const fd = new FormData(form);
    const e = state.editing;
    e.category = fd.get('category') || e.category;
    e.entry_date = fd.get('entry_date') || e.entry_date;
    e.title = (fd.get('title') || '').toString().trim();
    e.content = (fd.get('content') || '').toString();
    e.rating = Number(fd.get('rating') || 0);
    e.tags = (fd.get('tags') || '').toString().split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean);
    e.is_private = fd.get('is_private') === 'on';
    if (fd.get('remove_image') === 'on') state.removeImage = true;
    form.querySelectorAll('[name^="meta_"]').forEach((el) => { e.meta[el.name.slice(5)] = el.value.trim(); });
    return e;
  }

  async function submitEditor(form) {
    const e = collect(form);
    const c = CATS[e.category];
    const meta = {};
    c.fields.forEach((f) => {
      const v = e.meta[f.k];
      if (v !== undefined && v !== '') meta[f.k] = f.num ? Number(v) : v;
    });
    let title = e.title;
    if (!title && e.category === 'workout') title = [meta.type || '운동', meta.minutes ? `${meta.minutes}분` : ''].filter(Boolean).join(' ');
    const err = $('#form-error');
    if (!title) { err.textContent = '제목을 써 주세요.'; form.elements.title.focus(); return; }
    if (!e.entry_date) { err.textContent = '날짜를 골라 주세요.'; return; }

    const payload = {
      category: e.category, title, content: e.content.trim(), rating: e.rating || null,
      entry_date: e.entry_date, tags: e.tags, meta, is_private: e.is_private,
      image_url: state.removeImage ? null : (e.image_url || null),
    };
    if (e.id) payload.id = e.id;

    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = '저장하는 중…';
    try {
      await S.saveEntry(payload, state.editingFile);
      await loadEntries();
      $('#editor').close();
      toast('저장했어요');
      render();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false; btn.textContent = '저장하기';
    }
  }

  /* ------------------------------------------------------------------ */
  /* 로그인                                                               */
  /* ------------------------------------------------------------------ */
  function openLogin() {
    const dlg = $('#login');
    dlg.innerHTML = `
      <form id="login-form" class="sheet narrow">
        <header class="sheet-head"><h2>주인 로그인</h2><button type="button" class="icon" data-action="close-login" aria-label="닫기">✕</button></header>
        <label>이메일<input type="email" name="email" autocomplete="username" required></label>
        <label>비밀번호<input type="password" name="password" autocomplete="current-password" required></label>
        <p class="form-error" id="login-error" role="alert"></p>
        <footer class="sheet-foot"><button type="submit" class="btn primary">로그인</button></footer>
      </form>`;
    dlg.showModal();
  }

  /* ------------------------------------------------------------------ */
  /* 이벤트                                                               */
  /* ------------------------------------------------------------------ */
  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;
    const byId = (id) => state.entries.find((e) => e.id === id);

    switch (a) {
      case 'new': openEditor(null, t.dataset.cat ? { category: t.dataset.cat } : null); break;
      case 'edit': openEditor(byId(t.dataset.id)); break;
      case 'delete': {
        const e = byId(t.dataset.id);
        if (!e || !confirm(`'${e.title}' 기록을 지울까요? 되돌릴 수 없어요.`)) return;
        try { await S.deleteEntry(e.id); await loadEntries(); toast('지웠어요'); render(); }
        catch (ex) { toast(ex.message, true); }
        break;
      }
      case 'close-editor': $('#editor').close(); break;
      case 'clear-rating': {
        const form = $('#entry-form');
        form.querySelectorAll('[name="rating"]').forEach((r) => { r.checked = false; });
        form.querySelectorAll('.star-pick label').forEach((l) => l.classList.remove('on'));
        break;
      }
      case 'toggle-more': {
        const id = t.dataset.id;
        state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
        renderFeedList();
        break;
      }
      case 'filter-cat':
        state.filter.cat = t.dataset.cat || null;
        renderHero(); renderFeedList();
        break;
      case 'pick-day':
        state.filter.date = state.filter.date === t.dataset.date ? null : t.dataset.date;
        renderHero(); renderFeedList();
        if (state.filter.date) $('#view').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        break;
      case 'clear-date': state.filter.date = null; renderHero(); renderFeedList(); break;
      case 'reset-filter':
        state.filter = { cat: null, date: null, q: '' };
        renderHero(); renderFeed();
        break;
      case 'search-tag':
        state.filter.q = t.dataset.tag;
        if (state.view !== 'feed') location.hash = '#feed';
        else { $('#q').value = state.filter.q; renderFeedList(); }
        break;

      case 'open-login': openLogin(); break;
      case 'close-login': $('#login').close(); break;
      case 'logout': await S.signOut(); toast('로그아웃했어요'); break;

      case 'focus': state.focus = t.dataset.focus; renderPicks(); break;
      case 'copy-prompt': {
        const text = buildPrompt(state.focus);
        state.promptFallback = '';
        try {
          await navigator.clipboard.writeText(text);
          toast('복사했어요. claude.ai 새 채팅에 붙여 넣으세요');
        } catch (_) {
          state.promptFallback = text;
          renderPicks();
          const ta = $('#prompt-fallback');
          if (ta) { ta.focus(); ta.select(); }
        }
        break;
      }
      case 'parse-recs': {
        const box = $('#paste-recs');
        state.pasteText = box ? box.value : state.pasteText;
        try {
          state.recs = parseRecs(state.pasteText);
          state.recsError = '';
          state.pasteText = '';
          toast(`추천 ${state.recs.length}개를 정리했어요`);
        } catch (ex) {
          state.recsError = ex.message;
        }
        renderPicks();
        break;
      }
      case 'save-rec': {
        const i = Number(t.dataset.i);
        try {
          const row = await S.saveRec(state.recs[i]);
          state.saved = [row, ...(state.saved || [])];
          state.recs.splice(i, 1);
          toast('담아뒀어요'); renderPicks();
        } catch (ex) { toast(ex.message, true); }
        break;
      }
      case 'drop-rec': state.recs.splice(Number(t.dataset.i), 1); renderPicks(); break;
      case 'rec-done':
      case 'rec-undo': {
        try {
          const row = await S.updateRec(t.dataset.id, { status: a === 'rec-done' ? 'done' : 'saved' });
          state.saved = state.saved.map((r) => (r.id === row.id ? row : r));
          $('#saved-list').innerHTML = savedHTML();
        } catch (ex) { toast(ex.message, true); }
        break;
      }
      case 'rec-del': {
        try {
          await S.deleteRec(t.dataset.id);
          state.saved = state.saved.filter((r) => r.id !== t.dataset.id);
          $('#saved-list').innerHTML = savedHTML();
        } catch (ex) { toast(ex.message, true); }
        break;
      }
      case 'rec-write': {
        const r = state.saved.find((x) => x.id === t.dataset.id);
        if (r) openEditor(null, { category: r.category, title: r.title, meta: { [CREATOR_FIELD[r.category]]: r.creator } });
        break;
      }
    }
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'q') { state.filter.q = ev.target.value; renderFeedList(); }
    if (ev.target.id === 'paste-recs') state.pasteText = ev.target.value;
  });

  $('#editor').addEventListener('change', (ev) => {
    const form = $('#entry-form');
    const el = ev.target;
    if (el.name === 'category') { collect(form); drawEditor(); }
    else if (el.name === 'rating') {
      const v = Number(el.value);
      form.querySelectorAll('.star-pick label').forEach((l, i) => l.classList.toggle('on', i < v));
    } else if (el.name === 'image' && el.files[0]) {
      const f = el.files[0];
      if (f.size > 8 * 1024 * 1024) { $('#form-error').textContent = '사진은 8MB 이하로 골라 주세요.'; el.value = ''; return; }
      state.editingFile = f;
      $('.photo-preview', form).innerHTML = `<img src="${URL.createObjectURL(f)}" alt="고른 사진 미리보기">`;
    }
  });

  $('#editor').addEventListener('submit', (ev) => { ev.preventDefault(); submitEditor(ev.target); });

  $('#login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const btn = ev.target.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await S.signIn(fd.get('email'), fd.get('password'));
      $('#login').close();
      toast('로그인했어요');
    } catch (ex) {
      $('#login-error').textContent = ex.message;
      btn.disabled = false;
    }
  });

  init();
})();
