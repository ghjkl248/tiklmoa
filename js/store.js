// 저장소(브라우저 localStorage) + 카드 승인 알림 문자 파서
window.T = window.T || {};

(function () {
  const KEY = 'tiklmoa.v1';
  const DEFAULT = {
    expenses: [],
    settings: {
      defaultTicker: 'VOO',
      catTicker: {},          // 카테고리별 종목 (예: coffee → SCHD)
      drip: true,             // 배당 재투자
      fxMode: 'manual',       // manual | live
      fxManual: 1450,
      finnhubKey: '',
      goalDaily: 5000,        // 하루 줄이고 싶은 소비 목표(원)
    },
  };

  T.load = function () {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    T.state = s ? { ...DEFAULT, ...s, settings: { ...DEFAULT.settings, ...(s.settings || {}) } } : JSON.parse(JSON.stringify(DEFAULT));
  };
  T.save = function () { try { localStorage.setItem(KEY, JSON.stringify(T.state)); } catch (e) {} };

  T.tickerFor = function (cat) { return T.state.settings.catTicker[cat] || T.state.settings.defaultTicker; };

  // 지출 1건 → 전날 종가 기준 소수점 매수 기록
  T.makeLot = function ({ date, amount, merchant, category, ticker }) {
    const bp = T.buyPrice(ticker, date), fx = T.fx();
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      date, amount: Math.round(amount), merchant: merchant || '', category, ticker,
      price: bp.price, priceDate: bp.priceDate, fx,
      shares: amount / fx / bp.price,
      createdAt: new Date().toISOString(),
    };
  };
  T.addExpense = function (e) { const lot = T.makeLot(e); T.state.expenses.push(lot); T.save(); return lot; };
  T.removeExpense = function (id) { T.state.expenses = T.state.expenses.filter(x => x.id !== id); T.save(); };

  // ── 카드 승인 알림 파서 ──
  // 예) [Web발신] 신한카드(1234)승인 홍*동 5,000원(일시불)11/15 08:12 스타벅스 누적1,234,000원
  //     KB국민카드1*2*승인 홍*동 4,500원 일시불 11/15 14:20 메가MGC커피 누적...
  //     삼성카드 승인 4,800원 11/15 09:01 이디야커피
  T.parseCardMessages = function (text) {
    const year = new Date().getFullYear();
    const chunks = text.split(/\n\s*\n|(?=\[Web발신\])|(?=\[[^\]]*카드\])/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const out = [];
    for (const raw of chunks) {
      if (!/원/.test(raw)) continue;
      const cancel = /취소/.test(raw);
      const noCum = raw.replace(/(누적|잔액|한도|사용가능)[^\d]*[\d,]+\s*원/g, ' ');
      const am = noCum.match(/([\d]{1,3}(?:,\d{3})+|\d+)\s*원/);
      if (!am) continue;
      const amount = Number(am[1].replace(/,/g, ''));
      if (!amount) continue;
      let date = T.todayStr();
      const dm = raw.match(/(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
      let merchant = '';
      if (dm) {
        const mm = Number(dm[1]), dd = Number(dm[2]);
        if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
          let y = year;
          const cand = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
          if (cand > T.todayStr()) y -= 1; // 1월에 받은 12월 문자 등
          date = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        }
        merchant = raw.slice(raw.indexOf(dm[0]) + dm[0].length);
      }
      if (!merchant.trim()) merchant = raw.slice(raw.indexOf(am[0]) + am[0].length);
      merchant = merchant.replace(/누적.*$|잔액.*$|\(?일시불\)?|\(?할부[^)]*\)?|\d+개월|승인/g, ' ')
                         .replace(/^[\s\-:·,]+/, '').trim().split(' ').slice(0, 3).join(' ');
      const card = (raw.match(/([가-힣A-Za-z]+카드)/) || [])[1] || '';
      out.push({ date, amount, merchant: merchant || card || '카드 결제', card, cancel, raw });
    }
    return out;
  };

  // URL로 지출 추가: index.html?amount=5000&merchant=스타벅스&date=2026-11-15[&ticker=VOO]
  // → 휴대폰 단축어/자동화 앱이 카드 문자를 받으면 이 주소를 열도록 연결할 수 있음
  T.readUrlExpense = function () {
    const q = new URLSearchParams(location.search);
    const amount = Number((q.get('amount') || '').replace(/[^\d]/g, ''));
    if (!amount) return null;
    const merchant = q.get('merchant') || '';
    const category = q.get('category') || T.guessCategory(merchant);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date') : T.todayStr();
    const ticker = T.bySym[q.get('ticker')] ? q.get('ticker') : T.tickerFor(category);
    return { amount, merchant, category, date, ticker };
  };

  // 체험용 샘플 데이터: 최근 120일간 자주 하는 소비
  T.seedDemo = function () {
    const now = T.today(), picks = [
      ['스타벅스', 'coffee', 4700], ['메가MGC커피', 'coffee', 2000], ['배달의민족', 'delivery', 23000],
      ['GS25', 'store', 3800], ['카카오T 택시', 'transport', 12400], ['쿠팡', 'shopping', 18900], ['CGV', 'fun', 15000],
    ];
    let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let n = now - 120; n <= now; n++) {
      const k = rnd() < 0.8 ? (rnd() < 0.6 ? 0 : 1) : 2 + Math.floor(rnd() * 5);
      const [merchant, category, amount] = picks[k];
      T.state.expenses.push(T.makeLot({ date: T.toStr(n), amount, merchant, category, ticker: T.tickerFor(category) }));
      if (rnd() < 0.25) {
        const [m2, c2, a2] = picks[2 + Math.floor(rnd() * 5)];
        T.state.expenses.push(T.makeLot({ date: T.toStr(n), amount: a2, merchant: m2, category: c2, ticker: T.tickerFor(c2) }));
      }
    }
    T.save();
  };
})();
