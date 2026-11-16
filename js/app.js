// 화면
(function () {
  const $ = s => document.querySelector(s);
  const view = $('#view');
  let tab = 'home';

  // ── 포맷 ──
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const wonShort = n => {
    const a = Math.abs(n);
    if (a >= 1e8) return (n / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '억원';
    if (a >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만원';
    return won(n);
  };
  const pct = (v, base) => base ? ((v / base - 1) * 100) : 0;
  const signPct = p => (p > 0 ? '+' : '') + p.toFixed(1) + '%';
  const cls = p => p > 0.0001 ? 'up' : p < -0.0001 ? 'down' : '';
  const sh = n => n >= 1 ? n.toFixed(3) : n.toFixed(5);
  const usd = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const mdKo = s => { const [, m, d] = s.split('-'); return `${Number(m)}월 ${Number(d)}일`; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const name = s => T.bySym[s] ? T.bySym[s].n : s;

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function tickerOptions(sel) {
    const groups = { etf: [], div: [], stk: [] };
    T.UNIVERSE.forEach(u => groups[u.k].push(`<option value="${u.s}" ${u.s === sel ? 'selected' : ''}>${u.s} · ${esc(u.n)}</option>`));
    return Object.keys(groups).map(k => `<optgroup label="${T.KIND_LABEL[k]}">${groups[k].join('')}</optgroup>`).join('');
  }

  // ── 차트 ──
  function chart(points) {
    if (points.length < 2) return '<div class="muted small" style="padding:30px 0;text-align:center">기록이 쌓이면 그래프가 그려져요</div>';
    const W = 320, H = 130, P = 6;
    const max = Math.max(...points.map(p => Math.max(p.invested, p.value))) * 1.05 || 1;
    const x0 = points[0].n, x1 = points[points.length - 1].n || x0 + 1;
    const X = n => P + (W - 2 * P) * (n - x0) / Math.max(x1 - x0, 1);
    const Y = v => H - P - (H - 2 * P) * v / max;
    const path = key => points.map((p, i) => (i ? 'L' : 'M') + X(p.n).toFixed(1) + ' ' + Y(p[key]).toFixed(1)).join(' ');
    const area = path('value') + ` L${X(x1).toFixed(1)} ${H - P} L${X(x0).toFixed(1)} ${H - P} Z`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="누적 소비와 투자 평가액 추이">
      <path d="${area}" fill="var(--accent)" opacity=".10"/>
      <path d="${path('invested')}" fill="none" stroke="var(--sub)" stroke-width="1.5" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
      <path d="${path('value')}" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="legend"><span><i style="background:var(--accent)"></i>투자했다면 지금 가치</span><span><i style="background:var(--sub)"></i>쓴 돈 누적</span></div>`;
  }

  // ── 일별·월별 막대 그래프 ──
  let barMode = 'day', barSel = null;
  try { barMode = localStorage.getItem('tiklmoa.barMode') || 'day'; } catch (e) {}

  function barBuckets(mode) {
    const lots = T.state.expenses, now = T.today(), fx = T.fx(), out = [];
    if (mode === 'day') {
      for (let n = now - 13; n <= now; n++) {
        const s = T.toStr(n);
        out.push({ key: s, label: String(Number(s.slice(8))), title: mdKo(s), spent: 0, value: 0, count: 0, weekend: [0, 6].includes(new Date(n * 86400000).getUTCDay()) });
      }
    } else {
      const t = T.todayStr(); let y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
      const first = lots.length ? lots.map(l => l.date).sort()[0].slice(0, 7) : t.slice(0, 7);
      const keys = [];
      for (let i = 0; i < 12; i++) {
        const k = `${y}-${String(m).padStart(2, '0')}`; keys.unshift(k);
        if (i >= 5 && k <= first) break;
        if (--m === 0) { m = 12; y--; }
      }
      keys.forEach(k => out.push({ key: k, label: Number(k.slice(5)) + '월', title: `${k.slice(0, 4)}년 ${Number(k.slice(5))}월`, spent: 0, value: 0, count: 0 }));
    }
    const idx = {}; out.forEach((b, i) => { idx[b.key] = i; });
    for (const l of lots) {
      const k = mode === 'day' ? l.date : l.date.slice(0, 7);
      if (idx[k] == null) continue;
      const b = out[idx[k]];
      b.spent += l.amount; b.value += T.lotAt(l, now).valueUSD * fx; b.count++;
    }
    return out;
  }

  function barCard() { return `<section class="card" id="barCard"></section>`; }

  function drawBars() {
    const el = $('#barCard'); if (!el) return;
    const bs = barBuckets(barMode);
    if (barSel == null || barSel >= bs.length) barSel = bs.length - 1;
    const W = 320, H = 150, top = 14, bot = 20, n = bs.length, gw = W / n;
    const max = Math.max(...bs.map(b => Math.max(b.spent, b.value)), 1) * 1.08;
    const Y = v => H - bot - (H - top - bot) * v / max;
    const bw = Math.min(gw * 0.34, 14);
    const total = bs.reduce((a, b) => a + b.spent, 0), totalV = bs.reduce((a, b) => a + b.value, 0);
    const avg = total / (barMode === 'day' ? 14 : Math.max(bs.filter(b => b.count).length, 1));
    const bars = bs.map((b, i) => {
      const cx = gw * i + gw / 2, on = i === barSel;
      const h1 = H - bot - Y(b.spent), h2 = H - bot - Y(b.value);
      return `<g data-bar="${i}" style="cursor:pointer">
        <rect x="${gw * i}" y="0" width="${gw}" height="${H}" fill="${on ? 'var(--accent-soft)' : 'transparent'}" rx="6"/>
        <rect x="${cx - bw - 1}" y="${Y(b.spent)}" width="${bw}" height="${Math.max(h1, b.spent ? 1.5 : 0)}" rx="2.5" fill="var(--sub)" opacity="${on ? .75 : .4}"/>
        <rect x="${cx + 1}" y="${Y(b.value)}" width="${bw}" height="${Math.max(h2, b.value ? 1.5 : 0)}" rx="2.5" fill="var(--accent)" opacity="${on ? 1 : .7}"/>
        <text x="${cx}" y="${H - 5}" text-anchor="middle" font-size="${n > 12 ? 9.5 : 10.5}" fill="${on ? 'var(--ink)' : b.weekend ? 'var(--up)' : 'var(--sub)'}" font-weight="${on ? 700 : 400}">${b.label}</text>
      </g>`;
    }).join('');
    const avgY = Y(avg);
    const s = bs[barSel], p = pct(s.value, s.spent);
    el.innerHTML = `
      <div class="row" style="margin-bottom:6px"><h3 style="margin:0">${barMode === 'day' ? '최근 14일' : '월별'} 소비</h3>
        <div class="seg sm"><button data-bm="day" class="${barMode === 'day' ? 'on' : ''}">일별</button><button data-bm="month" class="${barMode === 'month' ? 'on' : ''}">월별</button></div></div>
      <div class="small muted">합계 <b class="num" style="color:var(--ink)">${won(total)}</b> · ${barMode === 'day' ? '하루' : '한 달'} 평균 ${won(avg)}</div>
      <svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${barMode === 'day' ? '일별' : '월별'} 소비와 투자 가치 막대 그래프">
        ${avg ? `<line x1="0" x2="${W}" y1="${avgY}" y2="${avgY}" stroke="var(--sub)" stroke-dasharray="3 3" stroke-width="1" opacity=".6"/>` : ''}
        ${bars}
      </svg>
      <div class="legend"><span><i style="background:var(--sub);opacity:.6"></i>쓴 돈</span><span><i style="background:var(--accent)"></i>투자했다면 지금</span><span><i style="background:none;border-top:1px dashed var(--sub);height:0"></i>평균</span></div>
      <div class="bar-detail">
        <div><b>${s.title}</b> <span class="muted small">${s.count}건</span></div>
        ${s.count ? `<div class="num">${won(s.spent)} → <b class="${cls(p)}">${won(s.value)}</b> <span class="small ${cls(p)}">${signPct(p)}</span></div>`
                  : `<div class="small" style="color:var(--accent)">${s.key === T.todayStr() || s.key === T.todayStr().slice(0, 7) ? '아직 쓴 돈이 없어요 👍' : '무지출! 잘했어요 👏'}</div>`}
      </div>`;
    el.querySelectorAll('[data-bar]').forEach(g => g.onclick = () => { barSel = Number(g.dataset.bar); drawBars(); });
    el.querySelectorAll('[data-bm]').forEach(b => b.onclick = () => {
      barMode = b.dataset.bm; barSel = null;
      try { localStorage.setItem('tiklmoa.barMode', barMode); } catch (e) {}
      drawBars();
    });
  }

  // ── 미국 증시 뉴스 ──
  const ago = t => {
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (!isFinite(m)) return '';
    if (m < 60) return `${m || 1}분 전`;
    if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
    return `${Math.floor(m / 1440)}일 전`;
  };
  function newsCard() {
    return `<section class="card" id="newsCard">
      <div class="row"><h3 style="margin:0">📰 미국 증시 주요 뉴스</h3><button class="del" id="newsRefresh" aria-label="뉴스 새로고침">↻</button></div>
      <ul class="list news" id="newsList"><li class="item muted small">뉴스를 불러오는 중…</li></ul></section>`;
  }
  async function loadNews(force) {
    const list = $('#newsList'); if (!list) return;
    if (force) list.innerHTML = '<li class="item muted small">뉴스를 불러오는 중…</li>';
    const items = await T.fetchNews(force);
    const el = $('#newsList'); if (!el) return; // 그 사이 다른 탭으로 이동
    el.innerHTML = items.length
      ? items.map(n => `<li class="item"><a class="news-link" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">
          <b>${esc(n.title)}</b><span class="tiny muted">${esc(n.source)}${n.source ? ' · ' : ''}${ago(n.time)}</span></a></li>`).join('')
        + `<li class="item" style="padding:8px 0 0"><a class="tiny muted" href="${T.NEWS_MORE}" target="_blank" rel="noopener noreferrer">뉴스 더 보기 ›</a></li>`
      : `<li class="item small muted">지금은 뉴스를 불러올 수 없어요. <a href="${T.NEWS_MORE}" target="_blank" rel="noopener noreferrer">구글 뉴스에서 보기 ›</a></li>`;
    const rb = $('#newsRefresh'); if (rb) rb.onclick = () => loadNews(true);
  }

  function lotItem(l, showDel) {
    const c = T.catById[l.category] || T.catById.etc;
    const st = T.lotAt(l, T.today()), v = st.valueUSD * T.fx(), p = pct(v, l.amount);
    const oy = T.lotOneYear(l);
    return `<li class="item">
      <div class="ico">${c.icon}</div>
      <div class="mid"><b>${esc(l.merchant || c.label)}</b>
        <span class="small muted"><span class="ticker">${l.ticker}</span> ${sh(l.shares)}주 · ${mdKo(l.priceDate)} 종가 ${usd(l.price)}</span></div>
      <div class="end num"><b>${won(l.amount)}</b>
        <span class="small ${cls(p)}">지금 ${won(v)}</span><br>
        <span class="tiny muted">1년 뒤 ${oy.projected ? '약 ' : ''}${won(oy.krw)}</span>
        ${showDel ? `<br><button class="del" data-del="${l.id}">삭제</button>` : ''}</div>
    </li>`;
  }

  function emptyState(msg) {
    return `<div class="card empty"><div class="e-ico">🌱</div><p><b>${msg}</b></p>
      <p class="small">오늘 쓴 커피값 하나부터 기록해 보세요.<br>그 돈으로 주식을 샀다면 어떻게 됐을지 보여드려요.</p>
      <button class="btn ghost sm" data-act="demo">예시 데이터로 둘러보기</button></div>`;
  }

  // ── 홈 ──
  function renderHome() {
    const lots = T.state.expenses;
    if (!lots.length) { view.innerHTML = envBanner() + emptyState('아직 기록이 없어요') + newsCard(); loadNews(); return; }
    const s = T.summary(lots), p = pct(s.value, s.invested);
    const today = T.todayStr(), monthKey = today.slice(0, 7);
    const todaySpent = lots.filter(l => l.date === today).reduce((a, l) => a + l.amount, 0);
    const monthSpent = lots.filter(l => l.date.startsWith(monthKey)).reduce((a, l) => a + l.amount, 0);
    const recent = [...lots].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
    // 가장 많이 쓴 카테고리 → 한 줄 성찰
    const topCat = Object.values(s.byCat).sort((a, b) => b.invested - a.invested)[0];
    const tc = topCat && T.catById[topCat.category];
    view.innerHTML = envBanner() + `
      <section class="card hero">
        <div class="label">지금까지 쓴 돈으로 주식을 샀다면</div>
        <div class="big num">${won(s.value)}</div>
        <div class="flow"><span>쓴 돈 ${won(s.invested)}</span><span>→</span><span class="pill">${signPct(p)}</span></div>
        <div class="hero-grid">
          <div><span>1년 뒤 예상</span><b class="num">${wonShort(s.oneYear)}</b></div>
          <div><span>받은 배당(세후)</span><b class="num">${won(s.div)}</b></div>
          <div><span>오늘 쓴 돈</span><b class="num">${won(todaySpent)}</b></div>
          <div><span>이번 달 쓴 돈</span><b class="num">${won(monthSpent)}</b></div>
        </div>
      </section>
      ${newsCard()}
      ${tc ? `<section class="card"><div class="small muted">돌아보기</div>
        <p style="margin:4px 0 0">가장 많이 쓴 곳은 <b>${tc.icon} ${tc.label}</b>이에요.
        ${topCat.count}번, <b>${won(topCat.invested)}</b>를 썼고, 투자했다면 1년 뒤 <b>${won(topCat.oneYear)}</b>가 돼요.</p></section>` : ''}
      ${barCard()}
      <section class="card"><h3>쓴 돈 vs 투자했다면 (누적)</h3>${chart(T.series(lots, 40))}</section>
      <section class="card"><div class="row"><h3>최근 기록</h3><button class="del" data-go="history">전체 보기 ›</button></div>
        <ul class="list">${recent.map(l => lotItem(l, false)).join('')}</ul></section>
      ${notice()}`;
    loadNews();
  }

  // ── 기록 ──
  function renderHistory() {
    const lots = T.state.expenses;
    if (!lots.length) { view.innerHTML = emptyState('아직 기록이 없어요'); return; }
    const byDate = {};
    lots.forEach(l => (byDate[l.date] = byDate[l.date] || []).push(l));
    const dates = Object.keys(byDate).sort().reverse();
    view.innerHTML = barCard() + dates.map(d => {
      const sum = byDate[d].reduce((a, l) => a + l.amount, 0);
      return `<div class="day-head"><span>${mdKo(d)}</span><span class="num">${won(sum)}</span></div>
        <section class="card" style="margin-top:4px;padding:6px 16px"><ul class="list">${byDate[d].map(l => lotItem(l, true)).join('')}</ul></section>`;
    }).join('') + notice();
  }

  // ── 내 주식 ──
  function renderHoldings() {
    const lots = T.state.expenses;
    if (!lots.length) { view.innerHTML = emptyState('아직 보유한 주식이 없어요'); return; }
    const s = T.summary(lots);
    const rows = Object.values(s.byTicker).sort((a, b) => b.value - a.value);
    view.innerHTML = `
      <section class="card"><div class="row"><div><div class="small muted">총 평가액</div><div style="font-size:26px;font-weight:800" class="num">${won(s.value)}</div></div>
        <div class="end num ${cls(pct(s.value, s.invested))}" style="text-align:right"><b>${signPct(pct(s.value, s.invested))}</b><div class="small">${won(s.value - s.invested)}</div></div></div>
        <div class="small muted" style="margin-top:6px">배당 ${T.state.settings.drip ? '자동 재투자' : '현금 보유'} · 받은 배당 ${won(s.div)} · 환율 ${T.fx().toLocaleString('ko-KR')}원</div></section>
      <section class="card" style="padding:6px 16px"><ul class="list">${rows.map(r => {
        const u = T.bySym[r.ticker], p = pct(r.value, r.invested);
        return `<li class="item"><div class="ico" style="font-size:12px;font-weight:800">${r.ticker}</div>
          <div class="mid"><b>${esc(u.n)}</b><span class="small muted">${sh(r.shares)}주 · 현재 ${usd(r.price)} · ${T.KIND_LABEL[u.k]}${u.y ? ` · 배당 ${u.y}%` : ''}</span>
          ${r.div > 0 ? `<br><span class="tiny muted">받은 배당 ${won(r.div)}</span>` : ''}</div>
          <div class="end num"><b>${won(r.value)}</b><span class="small ${cls(p)}">${signPct(p)}</span></div></li>`;
      }).join('')}</ul></section>
      ${notice()}`;
  }

  // ── 1년 뒤 ──
  function renderReflect() {
    const lots = T.state.expenses, st = T.state.settings;
    const s = lots.length ? T.summary(lots) : null;
    let avgDaily = 0;
    if (lots.length) {
      const first = Math.min(...lots.map(l => T.toDay(l.date)));
      avgDaily = s.invested / Math.max(T.today() - first + 1, 1);
    }
    const cats = s ? Object.values(s.byCat).sort((a, b) => b.invested - a.invested) : [];
    const maxCat = cats.length ? cats[0].invested : 1;
    view.innerHTML = `
      ${s ? `<section class="card"><h3>나의 소비, 1년 뒤에는</h3>
        <p class="small muted" style="margin-top:-4px">각 소비를 그날 주식으로 바꿨다면, 소비일로부터 1년이 지났을 때의 가치예요. 1년이 안 지난 건 기대수익률로 추정해요.</p>
        <ul class="list">${cats.map(c => {
          const cc = T.catById[c.category];
          return `<li class="item"><div class="ico">${cc.icon}</div><div class="mid"><div class="row"><b>${cc.label}</b><span class="num small" style="white-space:nowrap">${won(c.invested)} → <b class="up">${won(c.oneYear)}</b></span></div>
            <div class="bar"><i style="width:${(c.invested / maxCat * 100).toFixed(1)}%"></i></div><span class="tiny muted">${c.count}건</span></div></li>`;
        }).join('')}</ul></section>
      <section class="card"><h3>이 습관을 계속한다면</h3>
        <p class="small muted" style="margin-top:-4px">지금까지 하루 평균 <b>${won(avgDaily)}</b>를 썼어요. 이 돈을 매일 <span class="ticker">${st.defaultTicker}</span>에 넣는다면</p>
        ${[1, 3, 5, 10, 20].map(y => `<div class="row" style="padding:7px 0;border-top:1px solid var(--line)"><span>${y}년 뒤</span>
          <span class="num"><span class="small muted">원금 ${wonShort(avgDaily * 365 * y)} →</span> <b>${wonShort(T.futureValue(avgDaily, y, T.bySym[st.defaultTicker].er))}</b></span></div>`).join('')}
      </section>` : emptyState('기록이 쌓이면 1년 뒤를 보여드려요')}
      <section class="card"><h3>계산기: 하루 이만큼 아끼면?</h3>
        <div class="calc">
          <div class="wide"><div class="amount-input"><input id="cAmt" inputmode="numeric" value="${(st.goalDaily || 5000).toLocaleString('ko-KR')}"><span>원 / 하루</span></div></div>
          <select id="cTicker">${tickerOptions(st.defaultTicker)}</select>
          <select id="cYears">${[1, 3, 5, 10, 20, 30].map(y => `<option value="${y}" ${y === 10 ? 'selected' : ''}>${y}년</option>`).join('')}</select>
        </div>
        <div style="margin-top:14px"><div class="small muted" id="cPrin"></div><div class="result-big num" id="cRes"></div>
          <div class="tiny muted" id="cNote"></div></div>
      </section>
      ${notice()}`;
    const calc = () => {
      const amt = Number($('#cAmt').value.replace(/[^\d]/g, '')) || 0;
      const y = Number($('#cYears').value), u = T.bySym[$('#cTicker').value];
      $('#cPrin').textContent = `원금 ${won(amt * 365 * y)} (${y}년)`;
      $('#cRes').textContent = won(T.futureValue(amt, y, u.er));
      $('#cNote').textContent = `${u.s} 연 ${u.er}% 가정 · 매월 적립 · 세금·수수료 제외`;
    };
    ['cAmt', 'cYears', 'cTicker'].forEach(id => $('#' + id).addEventListener('input', e => {
      if (id === 'cAmt') { const v = Number(e.target.value.replace(/[^\d]/g, '')); e.target.value = v ? v.toLocaleString('ko-KR') : ''; }
      calc();
    }));
    calc();
  }

  // ── 설정 ──
  function renderSettings() {
    const st = T.state.settings;
    view.innerHTML = `
      <section class="card"><h3>투자 종목</h3>
        <div class="switch"><span>기본 종목</span><select id="sDefault">${tickerOptions(st.defaultTicker)}</select></div>
        <p class="small muted">소비 종류마다 다른 종목을 정할 수 있어요. 예: 커피값은 SCHD, 배달은 QQQ</p>
        ${T.CATEGORIES.map(c => `<div class="switch"><span>${c.icon} ${c.label}</span>
          <select data-cat="${c.id}"><option value="">기본 종목</option>${tickerOptions(st.catTicker[c.id] || '')}</select></div>`).join('')}
      </section>
      <section class="card"><h3>계산 방식</h3>
        <label class="switch"><span>배당 자동 재투자<br><span class="tiny muted">끄면 배당을 현금으로 모아요(세후 85%)</span></span><input type="checkbox" id="sDrip" ${st.drip ? 'checked' : ''}></label>
        <div class="switch"><span>환율</span><select id="sFxMode"><option value="manual" ${st.fxMode === 'manual' ? 'selected' : ''}>직접 입력</option><option value="live" ${st.fxMode === 'live' ? 'selected' : ''}>자동(인터넷)</option></select></div>
        <div class="switch"><span>직접 입력 환율 (원/달러)</span><input class="text-input" id="sFx" inputmode="numeric" value="${st.fxManual}"></div>
      </section>
      <section class="card"><h3>실제 시세 연결 (선택)</h3>
        <p class="small muted">지금은 샘플 시세로 계산해요. <b>Finnhub</b> 무료 API 키를 넣으면 실제 전날 종가로 맞춰집니다. 키는 이 기기에만 저장돼요.</p>
        <input class="text-input" id="sKey" placeholder="Finnhub API 키" value="${esc(st.finnhubKey)}" autocomplete="off">
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn sm" id="sFetch">시세 불러오기</button></div>
      </section>
      <section class="card"><h3>기록 보관·백업</h3>
        <p class="small muted" style="margin-top:-4px">기록은 이 기기의 <b>${T.env.inApp ? '앱 안 브라우저(카카오톡 등)' : T.env.standalone ? '홈 화면 앱' : '브라우저'}</b>에 저장돼요.
          ${T.persisted ? '브라우저에 영구 보관을 요청해 두었어요.' : ''} 매일 자동 백업을 14일치 보관해요.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost sm" id="sExport">백업 파일 저장</button>
          <button class="btn ghost sm" id="sImport">백업 파일 불러오기</button>
          <input type="file" id="sImportFile" accept=".json,application/json" hidden>
        </div>
        <div id="snapList" style="margin-top:12px"><span class="tiny muted">자동 백업 확인 중…</span></div>
      </section>
      <section class="card"><h3>데이터</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost sm" data-act="demo">예시 데이터 추가</button>
          <button class="btn ghost sm" id="sReset" style="color:var(--up)">모든 기록 지우기</button>
        </div>
        <p class="tiny muted" style="margin-top:10px">지우기 전에 자동으로 백업해 두므로, 실수로 지워도 위 자동 백업에서 되살릴 수 있어요.</p>
      </section>
      ${notice()}`;
    $('#sDefault').onchange = e => { st.defaultTicker = e.target.value; T.save(); toast('기본 종목: ' + e.target.value); };
    view.querySelectorAll('[data-cat]').forEach(sel => sel.onchange = e => {
      if (e.target.value) st.catTicker[sel.dataset.cat] = e.target.value; else delete st.catTicker[sel.dataset.cat];
      T.save(); toast('저장했어요');
    });
    $('#sDrip').onchange = e => { st.drip = e.target.checked; T.save(); };
    $('#sFxMode').onchange = async e => { st.fxMode = e.target.value; T.save(); if (st.fxMode === 'live') await refreshLive(true); };
    $('#sFx').onchange = e => { st.fxManual = Number(e.target.value.replace(/[^\d.]/g, '')) || 1450; T.save(); };
    $('#sKey').onchange = e => { st.finnhubKey = e.target.value.trim(); T.save(); };
    $('#sFetch').onclick = () => refreshLive(true);
    $('#sExport').onclick = async () => {
      const name = `티끌모아태산_백업_${T.todayStr()}.json`;
      const blob = new Blob([JSON.stringify(T.state, null, 2)], { type: 'application/json' });
      try { // 휴대폰: 공유 창(카카오톡 나에게 보내기, 파일 저장 등)
        const file = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: '티끌모아태산 백업' }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    };
    $('#sImport').onclick = () => $('#sImportFile').click();
    $('#sImportFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const n = T.importBackup(JSON.parse(await f.text()));
        toast(n ? `기록 ${n}건을 불러왔어요` : '새로 추가할 기록이 없어요');
        if (n) go('home');
      } catch (err) { toast(err.message || '파일을 읽지 못했어요'); }
      e.target.value = '';
    };
    $('#sReset').onclick = async () => {
      if (confirm('모든 소비 기록을 지울까요?\n(지우기 전 상태는 자동 백업에 남아요)')) { await T.resetAll(); toast('모두 지웠어요'); renderSettings(); }
    };
    renderSnapshots();
  }

  async function renderSnapshots() {
    const box = $('#snapList'); if (!box) return;
    const snaps = await T.listSnapshots();
    if (!$('#snapList')) return;
    if (!snaps.length) { box.innerHTML = '<span class="tiny muted">아직 자동 백업이 없어요. 기록을 추가하면 생겨요.</span>'; return; }
    box.innerHTML = `<div class="small" style="font-weight:700;margin-bottom:4px">자동 백업</div><ul class="list">${snaps.map(s => {
      const d = new Date(s.at);
      return `<li class="item" style="padding:8px 0"><div class="mid"><b class="small">${mdKo(s.date)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</b>
        <span class="tiny muted">${esc(s.label)} · 기록 ${s.count}건</span></div>
        <button class="btn ghost sm" data-restore="${esc(s.at)}">복원</button></li>`;
    }).join('')}</ul>`;
    box.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
      if (!confirm('이 백업 시점으로 되돌릴까요?\n(지금 상태도 백업해 둬요)')) return;
      const n = await T.restoreSnapshot(b.dataset.restore);
      toast(`기록 ${n}건으로 복원했어요`); go('home');
    });
  }

  // 기록이 지워지기 쉬운 환경 안내 (카카오톡 안 브라우저, 아이폰 사파리)
  function envBanner() {
    if (T.env.inApp) {
      const open = T.env.kakao ? `<a class="btn sm" style="display:inline-block;text-decoration:none;margin-top:8px" href="kakaotalk://web/openExternal?url=${encodeURIComponent(location.origin + location.pathname)}">브라우저로 열기</a>` : '';
      return `<section class="card warn"><b>⚠️ ${T.env.kakao ? '카카오톡' : '앱'} 안에서 열었어요</b>
        <p class="small" style="margin:4px 0 0">여기서 기록하면 나중에 지워질 수 있어요. 사파리·크롬으로 열어 홈 화면에 추가해서 써 주세요.</p>${open}</section>`;
    }
    let hidden = false; try { hidden = localStorage.getItem('tiklmoa.hideIosTip') === '1'; } catch (e) {}
    if (T.env.ios && !T.env.standalone && !hidden) {
      return `<section class="card warn"><div class="row"><b>📌 홈 화면에 추가해서 쓰세요</b><button class="del" data-act="hideTip">닫기</button></div>
        <p class="small" style="margin:4px 0 0">아이폰 사파리는 한동안 열지 않으면 기록을 지울 수 있어요. 공유 버튼 → <b>홈 화면에 추가</b>.<br>
        <span class="muted">사파리와 홈 화면 앱의 기록은 따로 저장돼요. 옮길 땐 설정의 백업 파일을 이용하세요.</span></p></section>`;
    }
    return '';
  }

  function notice() {
    return `<p class="notice">실제로 주식을 사지 않는 <b>가상 투자 기록</b>이에요. 투자 권유가 아니며,
      ${Object.keys(T.live).length ? '시세는 지연될 수 있어요' : '시세는 샘플 데이터예요'}. 미국 배당세 15%를 반영하고 수수료는 제외했어요.<br>
      소비 기록은 이 기기에만 저장되며, 이용자 수 파악을 위한 익명 방문 통계만 수집해요.</p>`;
  }

  // ── 소비 기록 시트 ──
  let mode = 'manual', draft = null, parsed = [];
  function openSheet(pref) {
    draft = Object.assign({ amount: 0, merchant: '', category: 'coffee', date: T.todayStr(), ticker: null }, pref || {});
    if (!draft.ticker) draft.ticker = T.tickerFor(draft.category);
    mode = 'manual'; parsed = [];
    $('#sheetBg').hidden = false; renderSheet();
  }
  function closeSheet() { $('#sheetBg').hidden = true; }

  function renderSheet() {
    document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    const body = $('#sheetBody');
    if (mode === 'card') {
      body.innerHTML = `
        <div class="field"><label>카드 승인 문자·알림을 복사해서 붙여넣으세요 (여러 건 가능)</label>
          <textarea id="cardText" placeholder="[Web발신]&#10;신한카드(1234)승인 홍*동&#10;4,700원(일시불)11/15 08:12&#10;스타벅스 누적 512,300원"></textarea></div>
        <button class="btn ghost" id="btnParse">내역 읽기</button>
        <div id="parsed"></div>`;
      $('#btnParse').onclick = () => {
        parsed = T.parseCardMessages($('#cardText').value).filter(p => !p.cancel);
        const box = $('#parsed');
        if (!parsed.length) { box.innerHTML = '<p class="small muted">승인 금액을 찾지 못했어요. 문자 전체를 붙여넣어 주세요.</p>'; return; }
        box.innerHTML = `<ul class="list" style="margin-top:10px">${parsed.map((p, i) => {
          const cat = T.guessCategory(p.merchant), t = T.tickerFor(cat), bp = T.buyPrice(t, p.date);
          p.category = cat; p.ticker = t;
          return `<li class="item"><div class="ico">${T.catById[cat].icon}</div><div class="mid"><b>${esc(p.merchant)}</b>
            <span class="small muted">${mdKo(p.date)} · <span class="ticker">${t}</span> ${sh(p.amount / T.fx() / bp.price)}주</span></div>
            <div class="end num"><b>${won(p.amount)}</b><label class="tiny muted"><input type="checkbox" data-pi="${i}" checked> 추가</label></div></li>`;
        }).join('')}</ul><button class="btn" id="btnAddParsed" style="margin-top:12px">선택한 ${parsed.length}건 투자로 바꾸기</button>`;
        $('#btnAddParsed').onclick = () => {
          const picked = [...box.querySelectorAll('[data-pi]')].filter(c => c.checked).map(c => parsed[Number(c.dataset.pi)]);
          picked.forEach(p => T.addExpense(p));
          closeSheet(); render(); toast(`${picked.length}건을 주식으로 바꿨어요`);
        };
      };
      return;
    }
    const bp = draft.amount ? T.buyPrice(draft.ticker, draft.date) : null;
    const shares = bp ? draft.amount / T.fx() / bp.price : 0;
    body.innerHTML = `
      <div class="field"><label>얼마 썼나요?</label>
        <div class="amount-input"><input id="fAmt" inputmode="numeric" placeholder="0" value="${draft.amount ? draft.amount.toLocaleString('ko-KR') : ''}"><span>원</span></div>
        <div class="chips" style="margin-top:10px">${[2000, 4500, 5000, 10000, 15000, 30000].map(v => `<button class="chip" data-amt="${v}">+${v.toLocaleString('ko-KR')}</button>`).join('')}</div></div>
      <div class="field"><label>어디에?</label>
        <div class="chips">${T.CATEGORIES.map(c => `<button class="chip ${c.id === draft.category ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${c.label}</button>`).join('')}</div>
        <input class="text-input" id="fMerchant" placeholder="사용처 (예: 스타벅스)" value="${esc(draft.merchant)}" style="margin-top:10px"></div>
      <div class="field" style="display:grid;grid-template-columns:1fr 1.4fr;gap:8px">
        <div><label class="small muted">날짜</label><input type="date" class="text-input" id="fDate" value="${draft.date}" max="${T.todayStr()}"></div>
        <div><label class="small muted">이 돈으로 살 주식</label><select id="fTicker">${tickerOptions(draft.ticker)}</select></div></div>
      <div class="preview" id="fPrev">${bp
        ? `<b>${draft.ticker}</b> ${sh(shares)}주를 살 수 있어요<br><span class="small muted">${mdKo(bp.priceDate)} 종가 ${usd(bp.price)} · 환율 ${T.fx().toLocaleString('ko-KR')}원 기준</span>`
        : '<span class="muted">금액을 넣으면 전날 종가로 몇 주를 살 수 있는지 보여드려요</span>'}</div>
      <button class="btn" id="fSave" ${draft.amount ? '' : 'disabled'}>투자로 바꾸기</button>`;

    const amt = $('#fAmt');
    amt.oninput = () => {
      const v = Number(amt.value.replace(/[^\d]/g, '')); draft.amount = v;
      amt.value = v ? v.toLocaleString('ko-KR') : '';
      softUpdate();
    };
    body.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => { draft.amount += Number(b.dataset.amt); renderSheet(); });
    body.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { draft.category = b.dataset.cat; draft.ticker = T.tickerFor(draft.category); draft.merchant = $('#fMerchant').value; renderSheet(); });
    $('#fMerchant').oninput = e => {
      draft.merchant = e.target.value;
      const g = T.guessCategory(draft.merchant);
      if (g !== 'etc' && g !== draft.category) { draft.category = g; draft.ticker = T.tickerFor(g); renderSheet(); const m = $('#fMerchant'); m.focus(); m.setSelectionRange(m.value.length, m.value.length); }
    };
    $('#fDate').onchange = e => { draft.date = e.target.value || T.todayStr(); softUpdate(); };
    $('#fTicker').onchange = e => { draft.ticker = e.target.value; softUpdate(); };
    $('#fSave').onclick = () => {
      if (!draft.amount) return;
      const lot = T.addExpense(draft);
      closeSheet(); render();
      toast(`${won(lot.amount)} → ${lot.ticker} ${sh(lot.shares)}주`);
    };
  }
  function softUpdate() {
    const bp = draft.amount ? T.buyPrice(draft.ticker, draft.date) : null;
    $('#fSave').disabled = !draft.amount;
    $('#fPrev').innerHTML = bp
      ? `<b>${draft.ticker}</b> ${sh(draft.amount / T.fx() / bp.price)}주를 살 수 있어요<br><span class="small muted">${mdKo(bp.priceDate)} 종가 ${usd(bp.price)} · 환율 ${T.fx().toLocaleString('ko-KR')}원 기준</span>`
      : '<span class="muted">금액을 넣으면 전날 종가로 몇 주를 살 수 있는지 보여드려요</span>';
  }

  // ── 라우팅 ──
  function render() {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    ({ home: renderHome, history: renderHistory, holdings: renderHoldings, reflect: renderReflect, settings: renderSettings }[tab])();
    drawBars();
    const live = Object.keys(T.live).length;
    const badge = $('#dataBadge');
    badge.textContent = live ? `실제 시세 연결됨 (${live}종목)` : '샘플 시세 · 가상 투자';
    badge.classList.toggle('live', !!live);
  }
  function go(t) { tab = t; render(); window.scrollTo(0, 0); }

  async function refreshLive(manual) {
    const st = T.state.settings;
    if (!st.finnhubKey && st.fxMode !== 'live') { if (manual) toast('API 키를 먼저 넣어주세요'); return; }
    const syms = [...new Set([st.defaultTicker, ...Object.values(st.catTicker), ...T.state.expenses.map(e => e.ticker)])];
    if (manual) toast('불러오는 중…');
    const r = await T.fetchLive(syms);
    if (manual) toast(r.error ? r.error : `시세 ${r.quotes}종목${r.fx ? ', 환율' : ''} 반영`);
    render();
  }

  // ── 이벤트 ──
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));
  $('#btnSettings').onclick = () => go(tab === 'settings' ? 'home' : 'settings');
  $('#btnAdd').onclick = () => openSheet();
  $('#btnClose').onclick = closeSheet;
  $('#sheetBg').onclick = e => { if (e.target.id === 'sheetBg') closeSheet(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => { mode = b.dataset.mode; renderSheet(); });
  view.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { if (confirm('이 기록을 지울까요?')) { T.removeExpense(del.dataset.del); render(); } return; }
    const g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go); return; }
    if (e.target.closest('[data-act="hideTip"]')) { try { localStorage.setItem('tiklmoa.hideIosTip', '1'); } catch (er) {} render(); return; }
    const a = e.target.closest('[data-act="demo"]');
    if (a) { T.seedDemo(); toast('최근 4개월 예시 소비를 넣었어요'); go('home'); }
  });

  // ── 시작 ──
  T.load();
  T.loadLiveCache();
  render();
  T.recover().then(n => {
    if (n) { render(); toast(`보관해 둔 기록 ${n}건을 되살렸어요`); }
    else if (tab === 'settings') renderSettings();
  });
  const fromUrl = T.readUrlExpense();
  if (fromUrl) {
    history.replaceState(null, '', location.pathname);
    openSheet(fromUrl);
  } else if (!Object.keys(T.live).length) {
    refreshLive(false);
  }
})();
