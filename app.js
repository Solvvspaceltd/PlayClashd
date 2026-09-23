/* ============================================================
   Clashd on the web
   Sign in with the same account as the app, then read the same
   endpoints the app reads. Where a field is not found in the
   payload, the card falls back to sample numbers and says so,
   so the page is never half-empty while the API settles.
   ============================================================ */
(function () {
  'use strict';

  // ── the only two things to set ───────────────────────────────
  // 1. Railway backend, no trailing slash, e.g. "https://fplarena-backend-production.up.railway.app"
  var API = window.CLASHD_API || '';
  // 2. Next FPL deadline, UK time. Used for the countdown until the backend supplies one.
  var DEADLINE = window.CLASHD_DEADLINE || '2026-10-10T10:00:00Z';

  var TOKEN_KEY = 'clashd.token';
  var token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }

  var state = { view: 'overview', live: false, data: null };

  // ── sample numbers, used only where the API gives us nothing ──
  var SAMPLE = {
    teamName: 'Your team',
    division: 'Premier division',
    gameweek: 6,
    rating: 6.4, ratingLabel: 'Solid', percentile: 78,
    efficiency: 87, bestXI: 90, swing: 34, rate: 52.3,
    points: 78, raw: 82, hit: 4,
    opponent: 'Nutmeg United', opponentPoints: 64, result: 'Won',
    position: 2, divisionSize: 8,
    platformAvg: 48, divisionAvg: 51, topAvg: 67,
    form: [44, 52, 31, 58, 49, 61],
    attribution: [['GK', 6], ['DEF', 18], ['MID', 34], ['FWD', 20]],
    benchCost: 46, benchRank: '3rd in Premier', benchDivisionAvg: 32, benchBest: 18,
    decisive: 'Captaining Palmer over Haaland cost 18 points.',
    captains: [
      { name: 'Haaland', fixture: 'MCI v BRE (H)', tag: 'Safe', kind: 'good', xp: '15.8' },
      { name: 'Palmer', fixture: 'CHE v BOU (H)', tag: 'Gain', kind: 'gain', xp: '13.6' },
      { name: 'Salah', fixture: 'LIV v EVE (A)', tag: 'Level', kind: 'flat', xp: '13.0' }
    ],
    chips: [['Bench Boost', '5 of 7'], ['Triple Captain', '4 of 7'], ['Free Hit', '6 of 7']],
    season: { total: 312, rank: 2, of: 12, best: 78, bestGw: 6, worst: 31, worstGw: 3,
              positions: [5, 4, 4, 3, 2, 2], won: 3, drawn: 1, lost: 1, pf: 289, pa: 254 }
  };

  // ── helpers ──────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // first defined value at any of the dotted paths
  function pick(obj, paths, fallback) {
    for (var i = 0; i < paths.length; i++) {
      var v = obj, parts = paths[i].split('.'), ok = true;
      for (var j = 0; j < parts.length; j++) {
        if (v == null || typeof v !== 'object' || !(parts[j] in v)) { ok = false; break; }
        v = v[parts[j]];
      }
      if (ok && v != null && v !== '') return v;
    }
    return fallback;
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  // ── api ──────────────────────────────────────────────────────
  function api(path, opts) {
    opts = opts || {};
    if (!API) return Promise.reject(new Error('no-api'));
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 15000);
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctl.signal
    }).then(function (r) {
      clearTimeout(timer);
      return r.text().then(function (t) {
        var body = null;
        try { body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
        if (!r.ok) {
          var msg = (body && (body.message || body.error)) || ('Request failed (' + r.status + ')');
          var err = new Error(msg); err.status = r.status; throw err;
        }
        return body;
      });
    });
  }
  // try each path, keep the first that answers
  function firstOf(paths) {
    var i = 0;
    function attempt() {
      if (i >= paths.length) return Promise.resolve(null);
      return api(paths[i++]).catch(function () { return attempt(); });
    }
    return attempt();
  }

  // ── sign in ──────────────────────────────────────────────────
  function showError(msg) {
    var box = $('loginErr');
    box.textContent = msg;
    box.classList.remove('hide');
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('loginBtn');
    var email = $('email').value.trim();
    var password = $('password').value;
    $('loginErr').classList.add('hide');
    if (!email || !password) { showError('Enter your email and password.'); return; }
    if (!API) { showError('This site is not connected to the Clashd server yet.'); return; }
    btn.disabled = true; btn.textContent = 'Signing in';
    api('/api/auth/login', { method: 'POST', body: { email: email, password: password } })
      .then(function (res) {
        var t = pick(res || {}, ['token', 'accessToken', 'jwt', 'data.token'], null);
        if (!t) throw new Error('Signed in, but no session was returned.');
        token = t;
        try { localStorage.setItem(TOKEN_KEY, t); } catch (err) {}
        start();
      })
      .catch(function (err) {
        btn.disabled = false; btn.textContent = 'Sign in';
        showError(err && err.status === 401 ? 'That email and password did not match.'
          : (err && err.message) || 'Could not sign in.');
      });
  });

  $('signout').addEventListener('click', function () {
    token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    $('shell').classList.add('hide');
    $('signin').classList.remove('hide');
    document.title = 'Clashd — sign in';
    var btn = $('loginBtn'); btn.disabled = false; btn.textContent = 'Sign in';
  });

  $('menuBtn').addEventListener('click', function () { $('shell').classList.toggle('open'); });

  // ── load ─────────────────────────────────────────────────────
  function start() {
    $('signin').classList.add('hide');
    $('shell').classList.remove('hide');
    document.title = 'Clashd — your analysis';
    render();
    Promise.all([
      firstOf(['/api/auth/me', '/api/users/me']),
      firstOf(['/api/summary']),
      firstOf(['/api/analysis/dashboard', '/api/analysis/overview', '/api/analysis'])
    ]).then(function (parts) {
      state.data = { me: parts[0], summary: parts[1], analysis: parts[2] };
      state.live = !!(parts[0] || parts[1] || parts[2]);
      render();
    }).catch(function () { render(); });
  }

  // ── view model: real values where we find them ───────────────
  function model() {
    var d = state.data || {}, me = d.me || {}, s = d.summary || {}, a = d.analysis || {};
    var m = {};
    m.teamName = pick(me, ['teamName', 'team.name', 'user.teamName', 'name'], SAMPLE.teamName);
    m.division = pick(s, ['division.name', 'divisionName'], SAMPLE.division);
    m.gameweek = num(pick(s, ['gameweek', 'currentGameweek', 'gw'], pick(a, ['gameweek'], SAMPLE.gameweek)), SAMPLE.gameweek);
    m.points = num(pick(s, ['gameweekPoints', 'points', 'netPoints'], SAMPLE.points), SAMPLE.points);
    m.hit = num(pick(s, ['hits', 'transferCost'], SAMPLE.hit), SAMPLE.hit);
    m.raw = m.points + m.hit;
    m.rating = num(pick(a, ['rating', 'overview.rating', 'score'], SAMPLE.rating), SAMPLE.rating);
    m.ratingLabel = pick(a, ['ratingLabel', 'overview.label'], SAMPLE.ratingLabel);
    m.percentile = num(pick(a, ['percentile', 'overview.percentile'], SAMPLE.percentile), SAMPLE.percentile);
    m.efficiency = num(pick(a, ['efficiency', 'overview.efficiency'], SAMPLE.efficiency), SAMPLE.efficiency);
    m.bestXI = num(pick(a, ['bestXI', 'overview.bestXI'], SAMPLE.bestXI), SAMPLE.bestXI);
    m.swing = num(pick(a, ['consistency.swing', 'swing'], SAMPLE.swing), SAMPLE.swing);
    m.rate = num(pick(a, ['seasonRate', 'rate'], SAMPLE.rate), SAMPLE.rate);
    m.platformAvg = num(pick(a, ['platformAverage', 'averages.platform'], SAMPLE.platformAvg), SAMPLE.platformAvg);
    m.divisionAvg = num(pick(a, ['divisionAverage', 'averages.division'], SAMPLE.divisionAvg), SAMPLE.divisionAvg);
    m.topAvg = num(pick(a, ['topAverage', 'averages.top'], SAMPLE.topAvg), SAMPLE.topAvg);
    m.form = pick(a, ['form', 'formSeries'], SAMPLE.form);
    if (!Array.isArray(m.form) || !m.form.length) m.form = SAMPLE.form;
    m.form = m.form.map(function (f) { return typeof f === 'object' ? num(f.points, 0) : num(f, 0); });
    m.opponent = pick(s, ['fixture.opponentName', 'fixture.opponent'], SAMPLE.opponent);
    m.opponentPoints = num(pick(s, ['fixture.opponentPoints', 'fixture.away'], SAMPLE.opponentPoints), SAMPLE.opponentPoints);
    m.position = num(pick(s, ['division.position', 'position'], SAMPLE.position), SAMPLE.position);
    m.divisionSize = num(pick(s, ['division.size', 'divisionSize'], SAMPLE.divisionSize), SAMPLE.divisionSize);
    m.benchCost = num(pick(a, ['biggestLever.value', 'benchCost'], SAMPLE.benchCost), SAMPLE.benchCost);
    m.decisive = pick(a, ['decisiveCall.text', 'decisive'], SAMPLE.decisive);
    m.captains = SAMPLE.captains;
    m.chips = SAMPLE.chips;
    m.attribution = SAMPLE.attribution;
    m.season = SAMPLE.season;
    return m;
  }

  // ── pieces ───────────────────────────────────────────────────
  function card(inner, cls) { return '<div class="card' + (cls ? ' ' + cls : '') + '">' + inner + '</div>'; }
  function lbl(t) { return '<div class="lbl">' + esc(t) + '</div>'; }

  function kpi(v, unit, name, note) {
    return card(lbl(name) + '<div class="v num">' + esc(v) + (unit ? '<small>' + esc(unit) + '</small>' : '') +
      '</div><div class="note">' + esc(note) + '</div>', 'kpi');
  }

  function scale(m) {
    var lo = 20, hi = 90, at = function (v) { return Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)); };
    var narrow = window.innerWidth < 780;
    var marks = [
      { n: (narrow ? 'Clashd ' : 'Every Clashd manager ') + m.platformAvg, v: m.platformAvg, c: '#7C8B83', me: false },
      { n: (narrow ? 'Division ' : 'Your division ') + m.divisionAvg, v: m.divisionAvg, c: '#0E7A3C', me: false },
      { n: 'You ' + m.points, v: m.points, c: '#35CE78', me: true },
      { n: (narrow ? 'Top 30 ' : 'Top 30 in form ') + m.topAvg, v: m.topAvg, c: '#E8B22E', me: false }
    ];
    var h = '<div class="scale"><div class="track"></div>';
    var low = 0;
    marks.sort(function (a, b) { return a.v - b.v; }).forEach(function (k) {
      var cls = k.me ? 'me' : 'other' + (low++ % 2 ? ' low' : '');
      h += '<div class="mark" style="left:' + at(k.v) + '%;background:' + k.c + '"></div>' +
        '<div class="tag ' + cls + '" style="left:' + at(k.v) + '%">' + esc(k.n) + '</div>';
    });
    h += '</div><div class="axis"><span>' + lo + '</span><span>' + ((lo + hi) / 2) + '</span><span>' + hi + '</span></div>';
    return card(lbl('Where you sat this week') + h);
  }

  function formChart(m) {
    var max = Math.max.apply(null, m.form.concat([1]));
    var h = '<div class="formbars">';
    m.form.forEach(function (v, i) {
      var up = i > 0 && v >= m.form[i - 1];
      var start = m.gameweek - m.form.length + 1;
      h += '<div class="b"><div class="n num">' + v + '</div><i class="' + (up ? 'up' : '') +
        '" style="height:' + Math.round(v / max * 150) + 'px"></i><div class="g">GW' + (start + i) + '</div></div>';
    });
    h += '</div><div class="note">Green means up on the week before.</div>';
    return card(lbl('Form, last ' + m.form.length + ' gameweeks') + h);
  }

  function fixture(m) {
    var won = m.points > m.opponentPoints;
    return '<div class="fixture"><div class="lbl" style="color:#35CE78">Your fixture</div>' +
      '<div class="teams"><div><div class="nm">' + esc(m.teamName) + '</div><div class="sc num">' + m.points + '</div></div>' +
      '<div class="mid">FT</div>' +
      '<div><div class="nm">' + esc(m.opponent) + '</div><div class="sc away num">' + m.opponentPoints + '</div></div></div>' +
      '<div class="line">' + (won ? 'Three points. ' : '') + 'You sit ' + ordinal(m.position) + ' of ' +
      m.divisionSize + ' in ' + esc(m.division.replace(' division', '')) + '.</div></div>';
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function captains(m) {
    var rows = m.captains.map(function (c) {
      return '<div class="row"><div class="who"><b>' + esc(c.name) + '</b><small>' + esc(c.fixture) + '</small></div>' +
        '<span class="chip ' + c.kind + '">' + esc(c.tag) + '</span><div class="xp num">' + esc(c.xp) + '</div></div>';
    }).join('');
    return card(lbl('Captain, next gameweek') + '<div class="rows">' + rows + '</div>' +
      '<div class="tiny" style="margin-top:10px">Safe protects a lead. Gain is the one your opponent does not own.</div>');
  }

  function chips(m) {
    var rows = m.chips.map(function (c) {
      return '<div class="row"><div class="who"><b>' + esc(c[0]) + '</b></div><div class="xp num" style="font-size:18px">' + esc(c[1]) + '</div></div>';
    }).join('');
    return card(lbl('Chips your rivals hold') + '<div class="rows">' + rows + '</div>');
  }

  function sampleChip() {
    return state.live ? '' :
      '<div class="card" style="border-color:rgba(232,178,46,.5)"><span class="chip sample">Sample data</span>' +
      '<div class="note">Not connected to the Clashd server yet, so these are illustrative figures in the real layout.</div></div>';
  }

  // ── views ────────────────────────────────────────────────────
  function viewOverview(m) {
    var left = '<div class="kpis">' +
      kpi(m.rating, '/ 10', 'Gameweek rating', m.ratingLabel + '. Above ' + m.percentile + '% of Clashd') +
      kpi(m.efficiency, '%', 'Efficiency', 'Of the best XI your fifteen could have produced') +
      kpi(ordinal(m.percentile), '', 'Percentile', 'Among every Clashd manager this week') +
      kpi(m.rate, '', 'Season rate', 'Points per gameweek played') + '</div>' +
      scale(m) + formChart(m) +
      card(lbl('The call that decided it') + '<h3>' + esc(m.decisive) + '</h3>' +
        '<div class="note">Your bench has cost ' + m.benchCost + ' this season, ' + SAMPLE.benchRank + '.</div>' +
        '<div class="bar" style="margin-top:14px"><i style="width:' +
        Math.round(m.benchCost / Math.max(m.benchCost, SAMPLE.benchDivisionAvg) * 100) + '%;background:#E8B22E"></i></div>' +
        '<div class="tiny" style="margin-top:8px">Division average ' + SAMPLE.benchDivisionAvg +
        ', best in Premier ' + SAMPLE.benchBest + '.</div>');
    var right = fixture(m) + captains(m) + chips(m) + sampleChip();
    return { left: left, right: right, title: 'Analysis', when: 'Gameweek ' + m.gameweek + ', final' };
  }

  function viewGameweek(m) {
    var rows = [['You', m.points, '#35CE78', ''],
                ['Your division average', m.divisionAvg, '#0E7A3C', plus(m.points - m.divisionAvg)],
                ['Every Clashd manager', m.platformAvg, '#9FB3A8', plus(m.points - m.platformAvg)],
                ['Top 30 in form', m.topAvg, '#E8B22E', plus(m.points - m.topAvg)]];
    var max = Math.max.apply(null, rows.map(function (r) { return r[1]; }));
    var bars = rows.map(function (r) {
      return '<div style="margin-top:14px"><div style="display:flex;align-items:baseline;gap:8px">' +
        '<div style="flex:1;font-size:14px">' + esc(r[0]) + '</div>' +
        '<div class="num" style="font-family:\'Barlow Condensed\',sans-serif;font-size:18px;font-weight:700">' + r[1] + '</div>' +
        '<div class="tiny" style="min-width:48px;text-align:right">' + esc(r[3]) + '</div></div>' +
        '<div class="bar"><i style="width:' + Math.round(r[1] / max * 100) + '%;background:' + r[2] + '"></i></div></div>';
    }).join('');

    var total = m.attribution.reduce(function (a, b) { return a + b[1]; }, 0);
    var cols = ['#6F8A7C', '#2E7D55', '#0E7A3C', '#35CE78'];
    var stack = m.attribution.map(function (a, i) {
      return '<div style="width:' + (a[1] / total * 100) + '%;background:' + cols[i] + '"></div>';
    }).join('');
    var legend = m.attribution.map(function (a, i) {
      return '<span><i style="background:' + cols[i] + '"></i>' + esc(a[0]) + ' ' + a[1] + '</span>';
    }).join('');

    var left = card(lbl('Gameweek ' + m.gameweek) +
        '<div style="display:flex;align-items:baseline;gap:10px;margin-top:8px">' +
        '<div class="num" style="font-family:\'Barlow Condensed\',sans-serif;font-size:56px;font-weight:800;line-height:1">' + m.points + '</div>' +
        '<div class="note" style="margin:0">net, after your hit &middot; ' + m.raw + ' &minus; ' + m.hit + '</div></div>') +
      card(lbl('How you compared') + bars) +
      card(lbl('Where your points came from') + '<div class="stack">' + stack + '</div><div class="legend">' + legend + '</div>');
    var right = fixture(m) +
      card(lbl('Efficiency') + '<h3>' + m.efficiency + '%</h3>' +
        '<div class="note">The best XI from the fifteen you already owned would have scored ' + m.bestXI +
        '. You took ' + m.points + ' of it.</div>') + sampleChip();
    return { left: left, right: right, title: 'Gameweek', when: 'Gameweek ' + m.gameweek + ', final' };
  }

  function plus(n) { return (n >= 0 ? '+' : '−') + Math.abs(Math.round(n)); }

  function viewSeason(m) {
    var s = m.season;
    var w = 560, h = 180, n = s.positions.length;
    var pts = s.positions.map(function (p, i) {
      return (20 + i * ((w - 40) / (n - 1))).toFixed(0) + ',' + ((p - 1) / 7 * (h - 40) + 20).toFixed(0);
    }).join(' ');
    var dots = s.positions.map(function (p, i) {
      return '<circle cx="' + (20 + i * ((w - 40) / (n - 1))).toFixed(0) + '" cy="' +
        ((p - 1) / 7 * (h - 40) + 20).toFixed(0) + '" r="4.5" fill="#0E7A3C"></circle>';
    }).join('');
    var chart = '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:auto;margin-top:12px" aria-label="Division position by gameweek">' +
      '<line x1="20" y1="20" x2="' + (w - 20) + '" y2="20" stroke="#E6EEE9"></line>' +
      '<line x1="20" y1="' + (h / 2) + '" x2="' + (w - 20) + '" y2="' + (h / 2) + '" stroke="#E6EEE9"></line>' +
      '<line x1="20" y1="' + (h - 20) + '" x2="' + (w - 20) + '" y2="' + (h - 20) + '" stroke="#E6EEE9"></line>' +
      '<polyline points="' + pts + '" fill="none" stroke="#0E7A3C" stroke-width="3" stroke-linejoin="round"></polyline>' + dots +
      '<text x="' + (w - 16) + '" y="24" text-anchor="end" font-size="11" fill="#7C8B83">1st</text>' +
      '<text x="' + (w - 16) + '" y="' + (h - 16) + '" text-anchor="end" font-size="11" fill="#7C8B83">8th</text></svg>';

    var left = '<div class="kpis">' +
      kpi(s.total, '', 'Season points', 'Net of every hit') +
      kpi(ordinal(s.rank), '', 'In your league', 'Of ' + s.of + ' managers') +
      kpi(s.best, '', 'Best week', 'Gameweek ' + s.bestGw) +
      kpi(s.worst, '', 'Worst week', 'Gameweek ' + s.worstGw) + '</div>' +
      card(lbl('Your place in ' + m.division.replace(' division', '')) + chart) +
      card(lbl('Head to head') + '<div class="split">' +
        '<div><div class="n num" style="color:#0E7A3C">' + s.won + '</div><div class="k">Won</div></div>' +
        '<div><div class="n num">' + s.drawn + '</div><div class="k">Drawn</div></div>' +
        '<div><div class="n num" style="color:#BE3229">' + s.lost + '</div><div class="k">Lost</div></div></div>' +
        '<div class="note">Points for <b>' + s.pf + '</b> &middot; points against <b>' + s.pa + '</b></div>');
    var right = chips(m) +
      card(lbl('Your biggest lever') + '<h3>The bench has cost you ' + m.benchCost + '</h3>' +
        '<div class="note">' + SAMPLE.benchRank + '. Two points a week is the gap to top spot.</div>') + sampleChip();
    return { left: left, right: right, title: 'Season', when: 'Through gameweek ' + m.gameweek };
  }

  // ── render ───────────────────────────────────────────────────
  function render() {
    var m = model();
    var v = state.view === 'gameweek' ? viewGameweek(m) : state.view === 'season' ? viewSeason(m) : viewOverview(m);
    $('viewTitle').textContent = v.title;
    $('viewWhen').textContent = v.when;
    $('whoName').textContent = m.teamName;
    $('whoSub').textContent = m.division;
    var page = $('page');
    page.innerHTML = '';
    page.appendChild(el('div', { 'class': 'col' }, v.left));
    page.appendChild(el('div', { 'class': 'col' }, v.right));
    Array.prototype.forEach.call(document.querySelectorAll('.rail nav a'), function (a) {
      a.classList.toggle('on', a.getAttribute('data-view') === state.view);
    });
  }

  function route() {
    var h = (location.hash || '').replace('#/', '');
    state.view = ['overview', 'gameweek', 'season'].indexOf(h) >= 0 ? h : 'overview';
    $('shell').classList.remove('open');
    if (!$('shell').classList.contains('hide')) render();
  }
  window.addEventListener('hashchange', route);

  // ── deadline countdown ───────────────────────────────────────
  function tick() {
    var ms = new Date(DEADLINE).getTime() - Date.now();
    if (!isFinite(ms)) return;
    if (ms < 0) ms = 0;
    var mins = Math.floor(ms / 60000);
    $('cDays').textContent = Math.floor(mins / 1440);
    $('cHrs').textContent = String(Math.floor(mins % 1440 / 60)).padStart(2, '0');
    $('cMin').textContent = String(mins % 60).padStart(2, '0');
  }
  tick();
  setInterval(tick, 30000);

  // ── go ───────────────────────────────────────────────────────
  route();
  if (token) start();
})();
