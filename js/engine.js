// 시세·환율·배당·평가 엔진
// - 기본: 종목별 결정론적 모의 시세(같은 날짜면 항상 같은 값). 기준일 종가 = universe의 샘플 기준가
// - 실시간 시세 키(Finnhub)가 있으면 최근 종가에 맞춰 모의 시세 전체를 보정
// - 주말은 직전 금요일 종가 사용(미국 공휴일은 단순화를 위해 무시)
window.T = window.T || {};

(function () {
  const DAY = 86400000;
  const TAX = 0.85; // 미국 배당 원천징수 15% 반영

  // ── 날짜 유틸 (날짜 문자열 'YYYY-MM-DD' ↔ 일 번호) ──
  function toDay(s) { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); }
  function toStr(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function dow(n) { return ((n + 4) % 7 + 7) % 7; } // 0=일 … 6=토
  function snap(n) { const w = dow(n); return w === 6 ? n - 1 : w === 0 ? n - 2 : n; }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  T.toDay = toDay; T.toStr = toStr; T.todayStr = todayStr;
  T.today = () => toDay(todayStr());
  T.prevTradingDay = n => snap(n - 1);           // 지출일 '전날' 종가일
  T.tradingDay = n => snap(n);

  const ANCHOR = toDay(T.ANCHOR_DATE); // 금요일
  const WMAP = { 0: 0, 3: 1, 4: 2, 5: 3, 6: 4 };    // 금요일 기준 요일 오프셋 → 거래일 오프셋
  function kOf(n) { const diff = snap(n) - ANCHOR; const w = Math.floor(diff / 7); return 5 * w + WMAP[diff - 7 * w]; }

  // ── 결정론적 난수 ──
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function gauss(seedStr) {
    let a = hash(seedStr);
    const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const u = Math.max(r(), 1e-12), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function shock(sym, k) { return 0.6 * gauss('MKT:' + k) + 0.8 * gauss(sym + ':' + k); }

  // ── 모의 시세 ──
  const cache = {};
  function simClose(sym, k) {
    const u = T.bySym[sym];
    let c = cache[sym];
    if (!c) {
      const sig = u.v / Math.sqrt(252);
      const mu = Math.log(1 + (u.er - u.y) / 100) / 252 - 0.5 * sig * sig;
      c = cache[sym] = { pos: [Math.log(u.p)], neg: [Math.log(u.p)], sig, mu };
    }
    if (k >= 0) {
      while (c.pos.length <= k) { const j = c.pos.length; c.pos.push(c.pos[j - 1] + c.mu + c.sig * shock(sym, j)); }
      return Math.exp(c.pos[k]);
    }
    const kk = -k;
    while (c.neg.length <= kk) { const j = c.neg.length; c.neg.push(c.neg[j - 1] - c.mu - c.sig * shock(sym, -j + 1)); }
    return Math.exp(c.neg[kk]);
  }

  // ── 실시간 시세 보정 ──
  T.live = {};     // sym → { c, pc, date }
  T.liveFx = null; // { rate, date }
  function factor(sym) {
    const q = T.live[sym];
    if (!q || !q.pc) return 1;
    return q.pc / simClose(sym, kOf(T.prevTradingDay(T.today())));
  }

  // 날짜 n 의 종가(USD). n이 오늘이고 실시간 현재가가 있으면 그것을 사용
  T.price = function (sym, n) {
    if (n >= T.today() && T.live[sym] && T.live[sym].c) return T.live[sym].c;
    return simClose(sym, kOf(n)) * factor(sym);
  };
  // 지출일 기준 매수가 = 전날(직전 거래일) 종가
  T.buyPrice = function (sym, dateStr) {
    const pd = T.prevTradingDay(toDay(dateStr));
    return { price: simClose(sym, kOf(pd)) * factor(sym), priceDate: toStr(pd) };
  };

  T.fx = function () {
    const s = T.state.settings;
    if (s.fxMode === 'live' && T.liveFx) return T.liveFx.rate;
    return Number(s.fxManual) || 1450;
  };

  // ── 배당 ──
  function exDates(sym, fromN, toN) { // (fromN, toN] 사이 배당락일
    const u = T.bySym[sym], out = [];
    if (!u.m.length || toN <= fromN) return out;
    const a = new Date(fromN * DAY), b = new Date(toN * DAY);
    for (let y = a.getUTCFullYear(); y <= b.getUTCFullYear(); y++) {
      for (const m of u.m) {
        const n = snap(Math.round(Date.UTC(y, m - 1, 15) / DAY));
        if (n > fromN && n <= toN) out.push(n);
      }
    }
    return out.sort((x, z) => x - z);
  }
  T.exDates = exDates;

  // 한 건의 매수(lot)의 n 시점 상태
  T.lotAt = function (lot, n) {
    const u = T.bySym[lot.ticker];
    const start = toDay(lot.date);
    if (n < start) return { shares: 0, valueUSD: 0, divUSD: 0, price: 0 };
    const drip = T.state.settings.drip;
    const g = u.m.length ? (u.y / 100) / u.m.length : 0;
    let shares = lot.shares, cash = 0, div = 0;
    for (const e of exDates(lot.ticker, start, n)) {
      const dps = T.price(lot.ticker, e) * g;
      const net = shares * dps * TAX;
      div += net;
      if (drip) shares += net / T.price(lot.ticker, e); else cash += net;
    }
    const price = T.price(lot.ticker, n);
    return { shares, price, valueUSD: shares * price + cash, divUSD: div };
  };

  // 지출 1건이 1년 뒤 얼마가 되는지 (지나지 않았으면 기대수익률로 남은 기간 추정)
  T.lotOneYear = function (lot) {
    const target = toDay(lot.date) + 365, now = T.today(), fx = T.fx();
    if (target <= now) return { krw: T.lotAt(lot, target).valueUSD * fx, projected: false };
    const cur = T.lotAt(lot, now).valueUSD * fx;
    const r = T.bySym[lot.ticker].er / 100;
    return { krw: cur * Math.pow(1 + r, (target - now) / 365), projected: true };
  };

  // 전체 요약
  T.summary = function (lots, n) {
    n = n == null ? T.today() : n;
    const fx = T.fx();
    let invested = 0, value = 0, div = 0, oneYear = 0;
    const byTicker = {}, byCat = {};
    for (const l of lots) {
      if (toDay(l.date) > n) continue;
      const st = T.lotAt(l, n), oy = T.lotOneYear(l);
      invested += l.amount; value += st.valueUSD * fx; div += st.divUSD * fx; oneYear += oy.krw;
      const t = byTicker[l.ticker] || (byTicker[l.ticker] = { ticker: l.ticker, shares: 0, invested: 0, value: 0, div: 0, count: 0, price: st.price });
      t.shares += st.shares; t.invested += l.amount; t.value += st.valueUSD * fx; t.div += st.divUSD * fx; t.count++;
      const c = byCat[l.category] || (byCat[l.category] = { category: l.category, invested: 0, value: 0, oneYear: 0, count: 0 });
      c.invested += l.amount; c.value += st.valueUSD * fx; c.oneYear += oy.krw; c.count++;
    }
    return { invested, value, div, oneYear, byTicker, byCat };
  };

  // 차트용: 첫 지출일부터 오늘까지 누적 지출 vs 평가액
  T.series = function (lots, points) {
    if (!lots.length) return [];
    const first = Math.min(...lots.map(l => toDay(l.date))), now = T.today();
    const span = Math.max(now - first, 1), step = Math.max(1, Math.ceil(span / (points || 40)));
    const out = [];
    for (let n = first; ; n += step) {
      const d = Math.min(n, now), s = T.summary(lots, d);
      out.push({ n: d, invested: s.invested, value: s.value });
      if (d >= now) break;
    }
    return out;
  };

  // 적립식 미래가치: 매일 daily 원씩 years 년간, 연 r% (월 복리)
  T.futureValue = function (daily, years, rPct) {
    const monthly = daily * 365 / 12, i = rPct / 100 / 12, months = years * 12;
    if (i === 0) return monthly * months;
    return monthly * ((Math.pow(1 + i, months) - 1) / i) * (1 + i);
  };

  // ── 실시간 데이터 가져오기 (선택) ──
  T.fetchLive = async function (symbols) {
    const s = T.state.settings, today = todayStr(), res = { quotes: 0, fx: false, error: null };
    if (s.fxMode === 'live') {
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        const j = await r.json();
        if (j && j.rates && j.rates.KRW) { T.liveFx = { rate: j.rates.KRW, date: today }; res.fx = true; }
      } catch (e) { res.error = '환율을 불러오지 못했습니다'; }
    }
    if (s.finnhubKey) {
      for (const sym of symbols) {
        try {
          const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(s.finnhubKey)}`);
          const j = await r.json();
          if (j && j.pc) { T.live[sym] = { c: j.c || j.pc, pc: j.pc, date: today }; res.quotes++; }
        } catch (e) { res.error = '시세를 불러오지 못했습니다'; }
      }
    }
    try { localStorage.setItem('tiklmoa.live', JSON.stringify({ live: T.live, fx: T.liveFx, date: today })); } catch (e) {}
    return res;
  };
  // ── 미국 증시 주요 뉴스 ──
  // Google 뉴스(한국어) '미국 증시' 검색의 주요 기사 순서(구글이 매긴 중요도·관련도) 상위 n건.
  // 브라우저에서 RSS를 직접 못 읽기 때문에 rss2json 변환 서비스를 거침. 실패 시 Finnhub(키 있을 때, 영문) 사용.
  const NEWS_KEY = 'tiklmoa.news', NEWS_TTL = 30 * 60 * 1000;
  T.NEWS_MORE = 'https://news.google.com/search?q=' + encodeURIComponent('미국 증시') + '&hl=ko&gl=KR&ceid=KR:ko';
  T.fetchNews = async function (force) {
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem(NEWS_KEY) || 'null');
        if (c && Date.now() - c.at < NEWS_TTL && c.items.length) return c.items;
      } catch (e) {}
    }
    let items = [];
    for (const when of ['1d', '3d']) {
      try {
        const rss = 'https://news.google.com/rss/search?q=' + encodeURIComponent('미국 증시 when:' + when) + '&hl=ko&gl=KR&ceid=KR:ko';
        const r = await fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rss));
        const j = await r.json();
        items = (j.items || []).map(i => {
          const m = i.title.match(/^(.*)\s-\s([^-]+)$/);
          return { title: m ? m[1].trim() : i.title, source: m ? m[2].trim() : '', url: i.link, time: Date.parse(i.pubDate.replace(' ', 'T') + 'Z') };
        });
        if (items.length >= 2) break;
      } catch (e) {}
    }
    if (items.length < 2 && T.state.settings.finnhubKey) {
      try {
        const r = await fetch('https://finnhub.io/api/v1/news?category=general&token=' + encodeURIComponent(T.state.settings.finnhubKey));
        const j = await r.json();
        items = (j || []).map(i => ({ title: i.headline, source: i.source, url: i.url, time: i.datetime * 1000 }));
      } catch (e) {}
    }
    items = items.filter(i => i.title && i.url).slice(0, 2);
    if (items.length) { try { localStorage.setItem(NEWS_KEY, JSON.stringify({ at: Date.now(), items })); } catch (e) {} }
    return items;
  };

  T.loadLiveCache = function () {
    try {
      const j = JSON.parse(localStorage.getItem('tiklmoa.live') || 'null');
      if (j && j.date === todayStr()) { T.live = j.live || {}; T.liveFx = j.fx || null; return true; }
    } catch (e) {}
    return false;
  };
})();
