/*
 * 気圧と周期の週予定: 計算だけの部品（画面と MCP の両方が使う・依存なし）
 * ブラウザでは globalThis.KiatsuEngine、Node では require/import で使える。
 * 医療の判断ではありません。点は「予定をずらす案を出すための目安」で、効果をうたう物ではありません。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KiatsuEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DOW = ['月', '火', '水', '木', '金', '土', '日']; // 0 = 月曜
  var DOW_EN = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var WEIGHT_JA = { light: '軽い', normal: 'ふつう', heavy: '重い' };
  var HIGH_THRESHOLD = 3; // この点以上を「しんどさの見込みが高い日」とする
  var STRONG_DROP = 6;    // 24 時間で 6 hPa 以上の下げを「強め」とする

  // ---- 日付の部品（UTC の日数で数える。端末のタイムゾーンに左右されない） ----
  function dayNum(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return NaN;
    var p = iso.split('-').map(Number);
    var n = Date.UTC(p[0], p[1] - 1, p[2]) / 86400000;
    return isoOf(n) === iso ? n : NaN;
  }
  function isoOf(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function addDays(iso, k) {
    var n = dayNum(iso);
    if (isNaN(n)) throw new Error('日付は YYYY-MM-DD の形で入れてください: ' + iso);
    return isoOf(n + k);
  }
  function dowIndex(iso) { return (((new Date(dayNum(iso) * 86400000).getUTCDay()) + 6) % 7); }
  function mondayOf(iso) {
    if (isNaN(dayNum(iso))) throw new Error('日付は YYYY-MM-DD の形で入れてください: ' + iso);
    return addDays(iso, -dowIndex(iso));
  }
  function fmtNum(x) { return String(Math.round(x * 10) / 10); }

  // ---- 周期 ----
  function normalizeCycle(c) {
    if (!c) return null;
    var start = c.lastStart || c.last_start || c.start;
    if (isNaN(dayNum(start))) return null;
    var len = Math.round(Number(c.length || c.cycleLen || c.cycle_length || 28));
    if (!isFinite(len)) len = 28;
    len = Math.min(45, Math.max(21, len));
    return { lastStart: start, length: len };
  }

  /**
   * 日付の時期を返す。周期日数 L のとき（一般に言われる目安の区切り）:
   *   月経 1〜5 日目／卵胞期 6〜(L-15) 日目／排卵のころ (L-14)〜(L-12) 日目／黄体期 それ以降
   * 点（しんどさへの足し）: 月経 1〜2 日目 = 2・月経 3〜5 日目 = 1・黄体期の後半（最後の 7 日）= 2・ほか 0
   */
  function phaseOf(iso, cycle) {
    var c = normalizeCycle(cycle);
    var n = dayNum(iso);
    if (!c || isNaN(n)) return null;
    var L = c.length;
    var day = ((n - dayNum(c.lastStart)) % L + L) % L + 1;
    var ovStart = L - 14, ovEnd = L - 12;
    var key, name;
    if (day <= 5) { key = 'menstrual'; name = '月経'; }
    else if (day < ovStart) { key = 'follicular'; name = '卵胞期'; }
    else if (day <= ovEnd) { key = 'ovulation'; name = '排卵のころ'; }
    else { key = 'luteal'; name = '黄体期'; }
    var late = key === 'luteal' && day >= L - 6;
    var points = 0, label = null;
    if (key === 'menstrual' && day <= 2) { points = 2; label = '月経の 1〜2 日目です'; }
    else if (key === 'menstrual') { points = 1; label = '月経の ' + day + ' 日目です'; }
    else if (late) { points = 2; label = '黄体期の後半です'; }
    return { key: key, name: name, day: day, length: L, late: late, points: points, label: label };
  }

  // ---- 気圧 ----
  /** 1 時間ごとの値（times は "YYYY-MM-DDTHH:MM"）を日平均にする。18 時間未満の日は捨てる。 */
  function dailyFromHourly(times, values) {
    var sums = {}, order = [];
    for (var i = 0; i < times.length; i++) {
      var v = values[i];
      if (v === null || v === undefined || !isFinite(v)) continue;
      var d = String(times[i]).slice(0, 10);
      if (!sums[d]) { sums[d] = { s: 0, n: 0 }; order.push(d); }
      sums[d].s += v; sums[d].n += 1;
    }
    return order.filter(function (d) { return sums[d].n >= 18; })
      .map(function (d) { return { date: d, hpa: Math.round(sums[d].s / sums[d].n * 10) / 10 }; });
  }

  /** 日ごとの「前日からの下げ幅」(hPa・下がるほど正)。前日の値が無い日は null（0 にはしない）。 */
  function dropMap(daily) {
    var by = {};
    (daily || []).forEach(function (p) {
      if (p && !isNaN(dayNum(p.date)) && isFinite(p.hpa) && p.hpa !== null) by[p.date] = Number(p.hpa);
    });
    return { by: by, drop: function (iso) {
      if (by[iso] === undefined) return null;
      var prev = addDays(iso, -1);
      if (by[prev] === undefined) return null;
      return Math.round((by[prev] - by[iso]) * 10) / 10;
    } };
  }

  /** 気圧の点: 下げ幅 2 未満 = 0／2 以上 = 1／4 以上 = 2／6 以上（強め）= 3 */
  function pressurePoints(drop) {
    if (drop === null || drop === undefined || drop < 2) return 0;
    if (drop < 4) return 1;
    if (drop < STRONG_DROP) return 2;
    return 3;
  }

  // ---- 予定 ----
  function normalizeWeight(w) {
    var s = String(w === undefined ? 'normal' : w).trim().toLowerCase();
    if (s === 'light' || s === '軽い' || s === '軽') return 'light';
    if (s === 'heavy' || s === '重い' || s === '重') return 'heavy';
    if (s === 'normal' || s === 'ふつう' || s === '普通' || s === 'medium') return 'normal';
    throw new Error('重さは 軽い／ふつう／重い（light／normal／heavy）のどれかです: ' + w);
  }
  function normalizeDow(d) {
    if (typeof d === 'number' && d >= 0 && d <= 6 && Math.floor(d) === d) return d; // 0 = 月曜
    var s = String(d).trim().toLowerCase();
    var i = DOW.indexOf(s.charAt(0));
    if (i >= 0 && (s.length === 1 || s === DOW[i] + '曜' || s === DOW[i] + '曜日')) return i;
    i = DOW_EN.indexOf(s.slice(0, 3));
    if (i >= 0) return i;
    throw new Error('曜日は 月〜日（または mon〜sun・0〜6 で 0 が月曜）で入れてください: ' + d);
  }

  function dayReason(day, role) {
    var pFrag, qFrag;
    var drop = day.drop;
    if (role === 'from') {
      if (day.points.pressure >= 1) pFrag = '前日から ' + fmtNum(drop) + ' hPa 下がる予報';
      if (day.phase && day.phase.points >= 1) qFrag = day.phase.label;
      if (pFrag && qFrag) return DOW[day.dowIndex] + '曜は' + pFrag + 'で、' + qFrag + '。';
      if (pFrag) return DOW[day.dowIndex] + '曜は' + pFrag + 'です。';
      if (qFrag) return DOW[day.dowIndex] + '曜は' + qFrag.replace(/です$/, '') + 'です。';
      return DOW[day.dowIndex] + '曜は点の合計が高めです。';
    }
    if (drop !== null && drop <= -1) pFrag = '前日から ' + fmtNum(-drop) + ' hPa 上がる予報';
    else pFrag = '気圧の下げ幅は ' + fmtNum(Math.max(drop === null ? 0 : drop, 0)) + ' hPa 程度の予報';
    if (day.phase) qFrag = day.phase.points >= 1 ? '周期は' + day.phase.label.replace(/です$/, '') + 'です' : '周期の面でも重めの時期ではありません';
    return DOW[day.dowIndex] + '曜は' + pFrag + (qFrag ? 'で、' + qFrag : 'です') + '。';
  }

  /**
   * 1 週間の計画。
   * input: { weekStart: 'YYYY-MM-DD'（週のどの日でもよい・月曜に直す）,
   *          events: [{id?, title, dow, time:'HH:MM', weight}],
   *          cycle: {lastStart, length} | null,
   *          pressure: [{date, hpa}]（日平均。前日の値があると下げ幅が出る）,
   *          today?: 'YYYY-MM-DD'（あれば過ぎた日は行き先にしない・札も付けない） }
   * 札の条件: 重さ「重い」の予定が、点 >= 3 の日にある。
   * 行き先: 同じ週で、気圧の下げ幅が分かり、点が元の日より低く、3 未満の日。
   *         （点 + その日の重い予定の数）が小さい順 → 同じ時刻の予定が無い日 → 元の日に近い日。
   */
  function planWeek(input) {
    input = input || {};
    var weekStart = mondayOf(input.weekStart);
    var cycle = normalizeCycle(input.cycle);
    var dm = dropMap(input.pressure);
    var today = input.today && !isNaN(dayNum(input.today)) ? input.today : null;
    var evs = (input.events || []).map(function (e, i) {
      if (!e || !e.title) throw new Error('予定には題（title）が要ります（' + (i + 1) + ' 件目）');
      var o = { id: e.id !== undefined ? String(e.id) : 'e' + (i + 1), title: String(e.title), time: e.time ? String(e.time) : '', weight: normalizeWeight(e.weight) };
      if (e.date && !isNaN(dayNum(e.date))) { o.date = e.date; o.dowIndex = dowIndex(e.date); }
      else o.dowIndex = normalizeDow(e.dow);
      return o;
    });

    var days = [];
    for (var i = 0; i < 7; i++) {
      var date = addDays(weekStart, i);
      var drop = dm.drop(date);
      var ph = phaseOf(date, cycle);
      var pp = pressurePoints(drop), hp = ph ? ph.points : 0, score = pp + hp;
      days.push({
        date: date, dowIndex: i, dow: DOW[i],
        hpa: dm.by[date] === undefined ? null : dm.by[date],
        drop: drop, scored: drop !== null, past: today !== null && date < today,
        phase: ph ? { key: ph.key, name: ph.name, day: ph.day, late: ph.late, points: ph.points, label: ph.label } : null,
        points: { pressure: pp, phase: hp }, score: score,
        level: score >= HIGH_THRESHOLD ? '高め' : (score >= 1 ? 'ふつう' : '穏やか'),
        strongDrop: drop !== null && drop >= STRONG_DROP,
        events: []
      });
    }
    evs.forEach(function (e) {
      var idx = e.date ? Math.round(dayNum(e.date) - dayNum(weekStart)) : e.dowIndex;
      if (idx < 0 || idx > 6) return; // この週の外の予定（date 指定）
      e.suggested = false;
      days[idx].events.push(e);
    });
    days.forEach(function (d) { d.events.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; }); });

    var heavyCount = days.map(function (d) { return d.events.filter(function (e) { return e.weight === 'heavy'; }).length; });
    var suggestions = [];
    days.forEach(function (src) {
      src.events.forEach(function (e) {
        if (e.weight !== 'heavy' || src.score < HIGH_THRESHOLD || src.past) return;
        var cands = days.filter(function (d) {
          return d.date !== src.date && d.scored && !d.past && d.score < src.score && d.score < HIGH_THRESHOLD;
        });
        cands.sort(function (a, b) {
          var ca = a.events.some(function (x) { return x.time && x.time === e.time; }) ? 1 : 0;
          var cb = b.events.some(function (x) { return x.time && x.time === e.time; }) ? 1 : 0;
          return ((a.score + heavyCount[a.dowIndex]) - (b.score + heavyCount[b.dowIndex])) || (ca - cb) ||
            (Math.abs(a.dowIndex - src.dowIndex) - Math.abs(b.dowIndex - src.dowIndex)) || (a.dowIndex - b.dowIndex);
        });
        var to = cands[0] || null;
        var reason = dayReason(src, 'from');
        if (to) { reason += dayReason(to, 'to'); heavyCount[to.dowIndex] += 1; }
        else reason += '同じ週には、点の低い日が見つかりませんでした。';
        e.suggested = true;
        suggestions.push({
          eventId: e.id, title: e.title, time: e.time,
          from: { date: src.date, dow: src.dow, score: src.score },
          to: to ? { date: to.date, dow: to.dow, score: to.score } : null,
          reason: reason
        });
      });
    });

    var summary = suggestions.length === 0
      ? ['今週は、しんどさの見込みが高い日にある重い予定はありません。']
      : suggestions.map(function (s) {
          return '「' + s.title + '」（' + s.from.dow + '曜' + (s.time ? ' ' + s.time : '') + '）は' +
            (s.to ? s.to.dow + '曜にずらす案があります。' : 'ずらす先の候補がありません。') + s.reason;
        });
    return { weekStart: weekStart, cycle: cycle, days: days, suggestions: suggestions, tags: suggestions.length, summary: summary };
  }

  // ---- 見本（作り物）: 画面の見本表示とテストで使う。実在の気圧・人の記録ではありません ----
  /** 週の月曜に対する見本の気圧（前日 + 7 日・作り物）。木曜に 8 hPa 下がる形。 */
  function samplePressure(weekStart) {
    var mon = mondayOf(weekStart);
    var v = [1016, 1018, 1016, 1017, 1009, 1011, 1014, 1016]; // 前の日曜〜日曜
    return v.map(function (h, i) { return { date: addDays(mon, i - 1), hpa: h }; });
  }
  /** 見本の周期（作り物）: 指定した月曜が 19 日目（木曜から黄体期の後半）になる開始日・28 日周期 */
  function sampleCycle(monday) { return { lastStart: addDays(mondayOf(monday), -18), length: 28 }; }
  var SAMPLE_EVENTS = [ // 作り物
    { id: 's1', title: '企画ミーティング', dow: '月', time: '10:00', weight: 'normal' },
    { id: 's2', title: '資料の整理', dow: '月', time: '16:00', weight: 'light' },
    { id: 's3', title: '資料作成', dow: '火', time: '09:30', weight: 'normal' },
    { id: 's4', title: 'チーム定例', dow: '火', time: '13:00', weight: 'normal' },
    { id: 's5', title: 'デザイン確認', dow: '水', time: '10:00', weight: 'normal' },
    { id: 's6', title: '買い物', dow: '水', time: '15:00', weight: 'light' },
    { id: 's7', title: '社内レビュー', dow: '木', time: '09:00', weight: 'heavy' },
    { id: 's8', title: '企画の発表準備', dow: '木', time: '14:00', weight: 'heavy' },
    { id: 's9', title: '提案資料作成', dow: '金', time: '10:00', weight: 'heavy' },
    { id: 's10', title: '取引先の訪問', dow: '金', time: '15:00', weight: 'normal' },
    { id: 's11', title: 'ヨガ', dow: '土', time: '09:00', weight: 'light' },
    { id: 's12', title: '友人とカフェ', dow: '土', time: '14:00', weight: 'light' },
    { id: 's13', title: '家の片付け', dow: '日', time: '10:00', weight: 'normal' }
  ];

  return {
    DOW: DOW, WEIGHT_JA: WEIGHT_JA, HIGH_THRESHOLD: HIGH_THRESHOLD, STRONG_DROP: STRONG_DROP,
    dayNum: dayNum, isoOf: isoOf, addDays: addDays, dowIndex: dowIndex, mondayOf: mondayOf,
    normalizeCycle: normalizeCycle, phaseOf: phaseOf,
    dailyFromHourly: dailyFromHourly, dropMap: dropMap, pressurePoints: pressurePoints,
    normalizeWeight: normalizeWeight, normalizeDow: normalizeDow,
    planWeek: planWeek, samplePressure: samplePressure, sampleCycle: sampleCycle, SAMPLE_EVENTS: SAMPLE_EVENTS
  };
});
