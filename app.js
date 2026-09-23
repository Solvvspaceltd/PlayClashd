/* ============================================================
   Clashd on the web
   Home, Leagues, Aside, Analysis and Profile, read from the same
   endpoints the phone app uses. Real values only: anything the
   API does not return shows as a dash, never as a made-up number.
   ============================================================ */
(function () {
  'use strict';

  var API = window.CLASHD_API || '';
  var TOKEN_KEY = 'clashd.token';
  var token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }

  var VIEWS = ['home', 'leagues', 'aside', 'analysis', 'profile'];
  var state = { view: 'home', mode: 'back', loading: true, error: null, d: {} };

  var C = { green: '#0E7A3C', bright: '#35CE78', gold: '#E8B22E', red: '#BE3229',
            grey: '#9FB3A8', dim: '#56675E' };

  // ── helpers ──────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function has(v) { return v !== null && v !== undefined && v !== ''; }
  function n(v, dash) { return has(v) && isFinite(Number(v)) ? Number(v) : (dash === undefined ? '—' : dash); }
  function ordinal(v) {
    if (!has(v) || !isFinite(Number(v))) return '—';
    var i = Number(v), s = ['th', 'st', 'nd', 'rd'], k = i % 100;
    return i + (s[(k - 20) % 10] || s[k] || s[0]);
  }
  function plus(v) { return !isFinite(v) ? '' : (v >= 0 ? '+' : '−') + Math.abs(Math.round(v)); }
  function card(inner, cls) { return '<div class="card' + (cls ? ' ' + cls : '') + '">' + inner + '</div>'; }
  function lbl(t) { return '<div class="lbl">' + esc(t) + '</div>'; }
  function kpi(v, unit, name, note) {
    return card(lbl(name) + '<div class="v num">' + esc(v) + (unit ? '<small>' + esc(unit) + '</small>' : '') +
      '</div>' + (note ? '<div class="note">' + esc(note) + '</div>' : ''), 'kpi');
  }
  function empty(msg) { return card('<div class="note" style="margin:0">' + esc(msg) + '</div>'); }
  function rowsBox(html) { return '<div class="rows">' + html + '</div>'; }
  function bar(pct, colour) {
    return '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%;background:' + colour + '"></i></div>';
  }

  // ── api ──────────────────────────────────────────────────────
  function api(path, opts) {
    opts = opts || {};
    if (!API) return Promise.reject(new Error('This site is not connected to the Clashd server yet.'));
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 20000);
    return fetch(API + path, {
      method: opts.method || 'GET', headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctl.signal
    }).then(function (r) {
      clearTimeout(timer);
      return r.text().then(function (t) {
        var body = null;
        try { body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
        if (!r.ok) {
          var err = new Error((body && (body.error || body.message)) || ('Request failed (' + r.status + ')'));
          err.status = r.status; throw err;
        }
        return body;
      });
    });
  }
  function soft(path) { return api(path).catch(function () { return null; }); }

  // ── sign in ──────────────────────────────────────────────────
  function showError(msg) { var b = $('loginErr'); b.textContent = msg; b.classList.remove('hide'); }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('loginBtn'), email = $('email').value.trim(), password = $('password').value;
    $('loginErr').classList.add('hide');
    if (!email || !password) { showError('Enter your email and password.'); return; }
    btn.disabled = true; btn.textContent = 'Signing in';
    api('/api/auth/login', { method: 'POST', body: { email: email, password: password } })
      .then(function (res) {
        var t = res && (res.token || res.accessToken || (res.data && res.data.token));
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
    state.d = {};
    $('shell').classList.add('hide');
    $('signin').classList.remove('hide');
    document.title = 'Clashd — sign in';
    var b = $('loginBtn'); b.disabled = false; b.textContent = 'Sign in';
  });

  $('menuBtn').addEventListener('click', function () { $('shell').classList.toggle('open'); });

  // ── load ─────────────────────────────────────────────────────
  function start() {
    $('signin').classList.add('hide');
    $('shell').classList.remove('hide');
    document.title = 'Clashd';
    state.loading = true; state.error = null;
    render();
    Promise.all([
      api('/api/auth/me').catch(function (e) { throw e; }),
      soft('/api/summary'), soft('/api/leagues'),
      soft('/api/analysis'), soft('/api/analysis/plan'), soft('/api/notifications')
    ]).then(function (r) {
      state.d = { me: r[0], summary: r[1], leagues: r[2], analysis: r[3], plan: r[4], notes: r[5] };
      state.loading = false;
      render();
    }).catch(function (err) {
      if (err && err.status === 401) {
        token = null;
        try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
        $('shell').classList.add('hide'); $('signin').classList.remove('hide');
        showError('Your session has expired. Sign in again.');
        return;
      }
      state.loading = false;
      state.error = (err && err.message) || 'Could not reach the Clashd server.';
      render();
    });
  }

  // ── home ─────────────────────────────────────────────────────
  function viewHome() {
    var s = state.d.summary || {}, p = state.d.plan || {}, a = state.d.analysis || {};
    var f = s.nextFixture || {}, m = (p.match || {});
    var net = has(s.gameweekPoints) ? s.gameweekPoints : null;
    var hits = n(s.hits, 0);

    var formPills = (s.form || []).map(function (r) {
      var col = r === 'W' ? C.green : r === 'L' ? C.red : C.dim;
      return '<span class="pill" style="border-color:' + col + ';color:' + col + '">' + esc(r) + '</span>';
    }).join('');

    var series = s.pointsSeries || [];
    var max = Math.max.apply(null, series.map(function (x) { return x.points; }).concat([1]));
    var bars = series.map(function (x) {
      return '<div class="b"><div class="n num">' + n(x.points) + '</div>' +
        '<i style="height:' + Math.round(x.points / max * 150) + 'px"></i>' +
        '<div class="g">GW' + n(x.gameweek) + '</div></div>';
    }).join('');

    var left = '<div class="kpis">' +
      kpi(n(net), '', 'Gameweek ' + n(s.currentGameweek), hits ? 'Net, after a ' + hits + ' point hit' : 'Net score') +
      kpi(n(s.seasonPoints), '', 'Season', 'Points so far') +
      kpi(ordinal(s.platformRank), '', 'On Clashd', has(s.rankMove) && s.rankMove !== 0
        ? (s.rankMove > 0 ? 'Up ' + s.rankMove + ' this week' : 'Down ' + Math.abs(s.rankMove) + ' this week') : 'Across every manager') +
      kpi(n(s.gameweekHigh), '', 'Weekly high', 'Best score on Clashd this week') + '</div>';

    left += series.length ? card(lbl('Your season, gameweek by gameweek') +
      '<div class="formbars">' + bars + '</div>' +
      '<div class="note">Best ' + n((s.bestGw || {}).points) + ' in GW' + n((s.bestGw || {}).gameweek) +
      ', worst ' + n((s.worstGw || {}).points) + ' in GW' + n((s.worstGw || {}).gameweek) +
      ', average ' + n(s.avgPoints) + '.</div>') : '';

    if (p.ready && m.opponent) {
      left += card(lbl('Next gameweek, forecast') +
        '<h3>' + esc(m.verdict || '') + '</h3>' +
        '<div class="note">' + esc(m.detail || '') + '</div>' +
        '<div class="split" style="margin-top:16px">' +
        '<div><div class="n num">' + n(m.me) + '</div><div class="k">You, forecast</div></div>' +
        '<div><div class="n num">' + n(m.winChance) + '%</div><div class="k">Win chance</div></div>' +
        '<div><div class="n num">' + n(m.them) + '</div><div class="k">' + esc(m.opponent) + '</div></div></div>');
    }

    var right = '';
    if (f.opponent) {
      var live = f.live && (has(f.myScore) || has(f.opponentScore));
      right += '<div class="fixture"><div class="lbl" style="color:#35CE78">Gameweek ' + n(f.gameweek) + ' &middot; ' + esc(f.division || '') + '</div>' +
        '<div class="teams"><div><div class="nm">' + esc(s.team || 'You') + '</div>' +
        '<div class="sc num">' + (live ? n(f.myScore) : '<span class="tbc">Not started</span>') + '</div></div>' +
        '<div class="mid">' + (live ? 'LIVE' : 'v') + '</div>' +
        '<div><div class="nm">' + esc(f.opponent) + '</div>' +
        '<div class="sc away num">' + (live ? n(f.opponentScore) : '<span class="tbc">&nbsp;</span>') + '</div></div></div>' +
        '<div class="line">Your form ' + (s.form || []).join(' ') + ' &middot; theirs ' + (f.opponentForm || []).join(' ') + '</div></div>';
    }
    if (a.stakes && a.stakes.message) {
      right += card(lbl('What is at stake') + '<h3>' + esc(a.stakes.division || '') + '</h3>' +
        '<div class="note">' + esc(a.stakes.message) + '</div>');
    }
    if (s.best && s.best.name) {
      right += card(lbl('Your best competition') + '<h3>' + esc(s.best.name) + '</h3>' +
        '<div class="note">' + ordinal(s.best.position) + ' with ' + n(s.best.total) + ' points.</div>');
    }
    if (p.captain && p.captain.pick) {
      right += card(lbl('Captain for gameweek ' + n(p.gameweek)) +
        '<h3>' + esc(p.captain.pick.name) + '</h3>' +
        '<div class="note">' + esc(p.captain.pick.why || p.captain.reason || '') + '</div>');
    }
    if (formPills) right += card(lbl('Recent results') + '<div class="pills">' + formPills + '</div>');

    return { left: left, right: right, title: 'Home', when: s.team ? esc(s.team) : '' };
  }

  // ── leagues ──────────────────────────────────────────────────
  function viewLeagues() {
    var s = state.d.summary || {}, all = state.d.leagues || [], a = state.d.analysis || {};
    var mine = s.leagues || [];
    if (!mine.length && !all.length) return { left: empty('No competitions found on your account.'), right: '', title: 'Leagues', when: '' };

    var meta = {};
    (all || []).forEach(function (l) { meta[l.id] = l; });

    var rows = mine.map(function (l) {
      var extra = meta[l.leagueId] || {};
      var place = has(l.tablePosition) ? ordinal(l.tablePosition) + ' of ' + n(l.tableTotal) : ordinal(l.position) + ' of ' + n(l.total);
      var delta = has(l.rankDelta) && l.rankDelta !== 0
        ? '<span style="color:' + (l.rankDelta > 0 ? C.green : C.red) + '">' + (l.rankDelta > 0 ? '▲' : '▼') + Math.abs(l.rankDelta) + '</span>' : '';
      return '<div class="row"><div class="who"><b>' + esc(l.name) + '</b>' +
        '<small>' + (l.division ? esc(l.division) + ' division &middot; ' : '') +
        (extra.prizeInfo ? 'Prize ' + esc(extra.prizeInfo) + ' &middot; ' : '') +
        (has(extra.entryCount) ? extra.entryCount + ' managers' : '') + '</small></div>' +
        '<div style="text-align:right;min-width:104px"><div style="font-weight:700">' + place + ' ' + delta + '</div>' +
        '<small style="color:#7C8B83">' + n(l.leaguePoints ? l.leaguePoints : l.points) + ' pts</small></div></div>';
    }).join('');

    var left = card(lbl('Your competitions') + rowsBox(rows));

    var notJoined = (all || []).filter(function (l) { return !l.joined; });
    if (notJoined.length) {
      left += card(lbl('Open to join') + rowsBox(notJoined.map(function (l) {
        return '<div class="row"><div class="who"><b>' + esc(l.name) + '</b><small>' + esc(l.description || '') + '</small></div>' +
          '<div class="tiny">' + n(l.entryCount) + ' in</div></div>';
      }).join('')) + '<div class="tiny" style="margin-top:10px">Joining happens in the app.</div>');
    }

    var right = '';
    if (a.stakes && a.stakes.message) {
      right += card(lbl('Clashd Premier League') +
        '<h3>' + esc(a.stakes.division || '') + ', ' + ordinal(a.stakes.position) + ' of ' + n(a.stakes.total) + '</h3>' +
        '<div class="note">' + esc(a.stakes.message) + '</div>');
    }
    if (a.h2h && a.h2h.length) {
      right += card(lbl('Head to head') + rowsBox(a.h2h.map(function (h) {
        var res = h.w ? 'Won' : h.l ? 'Lost' : 'Drew';
        var col = h.w ? C.green : h.l ? C.red : C.dim;
        return '<div class="row"><div class="who"><b>' + esc(h.opponent) + '</b><small>' + n(h['for']) + ' &ndash; ' + n(h.against) + '</small></div>' +
          '<div style="color:' + col + ';font-weight:700">' + res + '</div></div>';
      }).join('')));
    }
    return { left: left, right: right, title: 'Leagues', when: mine.length + ' competitions' };
  }

  // ── aside ────────────────────────────────────────────────────
  function viewAside() {
    var p = state.d.plan || {}, sq = p.squad || {}, players = sq.players || [];
    if (!players.length) {
      return { left: empty('Your squad appears here once the next gameweek is forecast.'), right: '', title: 'Aside', when: '' };
    }
    var order = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
    var starters = players.filter(function (x) { return x.starter; })
      .sort(function (x, y) { return (order[x.position] - order[y.position]) || (y.xp - x.xp); });
    var bench = players.filter(function (x) { return !x.starter; });

    function line(x) {
      var flag = x.status && x.status !== 'a' ? '<span class="chip flat" style="color:' + C.red + ';border-color:' + C.red + '">Doubt</span>' : '';
      var bits = [x.position, x.team, x.fixture].filter(function (y) { return has(y); }).map(esc);
      return '<div class="row"><div class="who"><b>' + esc(x.name) + '</b><small>' + bits.join(' &middot; ') + '</small></div>' +
        flag + '<div class="xp num">' + (has(x.xp) ? Number(x.xp).toFixed(1) : '—') + '</div></div>';
    }

    var left = card(lbl('Your eleven, forecast for gameweek ' + n(p.gameweek)) + rowsBox(starters.map(line).join('')) ) +
      (bench.length ? card(lbl('Your bench') + rowsBox(bench.map(line).join(''))) : '');

    var right = card(lbl('Squad strength') +
      '<h3>' + n(sq.score) + ' / 100</h3>' +
      '<div class="note">' + ordinal(sq.rank) + ' of ' + n(sq.of) + ' in your division.</div>' +
      (sq.ahead && sq.ahead.length ? '<div class="tiny" style="margin-top:10px">Ahead of you: ' + esc(sq.ahead.join(', ')) + '</div>' : ''));
    if (sq.weakest) {
      right += card(lbl('Weakest link') + '<h3>' + esc(sq.weakest.name) + '</h3>' +
        '<div class="note">' + esc(sq.weakest.team || '') + ' &middot; ' + n(sq.weakest.xp) +
        ' expected over the run, ' + n(sq.weakest.pct) + '% of the best in his position.</div>');
    }
    right += card(lbl('Naming your seven') +
      '<div class="note" style="margin-top:6px">Aside picks lock at the FPL deadline and are made in the app for now. ' +
      'Picking from the web is the next thing we add.</div>');

    return { left: left, right: right, title: 'Aside', when: 'Gameweek ' + n(p.gameweek) };
  }

  // ── analysis ─────────────────────────────────────────────────
  function toggle() {
    return '<div class="seg-toggle">' +
      '<button type="button" data-mode="back" class="' + (state.mode === 'back' ? 'on' : '') + '">Look back</button>' +
      '<button type="button" data-mode="ahead" class="' + (state.mode === 'ahead' ? 'on' : '') + '">Plan ahead</button></div>';
  }

  function viewAnalysisBack() {
    var a = state.d.analysis || {}, d = a.dashboard || {};
    if (!a.ready) return { left: empty('Your report appears once the gameweek has been scored.'), right: '', title: 'Analysis', when: '' };
    var f = d.field || {}, e = d.efficiency || {}, c = d.consistency || {}, b = a.benchmarks || {};

    var left = '<div class="kpis">' +
      kpi(n(a.rating), '/ 10', 'Gameweek rating', 'Gameweek ' + n(a.reportGameweek)) +
      kpi(n(e.pct), '%', 'Efficiency', 'You scored ' + n(e.actual) + ' of a possible ' + n(e.possible)) +
      kpi(ordinal(d.percentile), '', 'Percentile', 'Among ' + n(f.managers) + ' Clashd managers') +
      kpi(n(c.rate), '', 'Season rate', 'Points per gameweek, ' + esc(c.label || '')) + '</div>';

    // where you sat
    if (has(f.myScore)) {
      var lo = Math.min(f.lowest, f.myScore), hi = Math.max(f.highest, f.myScore);
      var span = Math.max(1, hi - lo);
      var marks = [
        { nm: 'Lowest ' + n(f.lowest), v: f.lowest, c: C.grey },
        { nm: 'Clashd average ' + n(f.average), v: f.average, c: C.dim },
        { nm: 'Division ' + n(b.divisionAvg), v: b.divisionAvg, c: C.green },
        { nm: 'Top 30 ' + n(b.topAvg), v: b.topAvg, c: C.gold },
        { nm: 'You ' + n(f.myScore), v: f.myScore, c: C.bright, me: true },
        { nm: 'Highest ' + n(f.highest), v: f.highest, c: C.grey }
      ].filter(function (k) { return has(k.v); }).sort(function (x, y) { return x.v - y.v; });
      var h = '<div class="scale"><div class="track"></div>', low = 0;
      marks.forEach(function (k) {
        var at = (k.v - lo) / span * 100;
        h += '<div class="mark" style="left:' + at + '%;background:' + k.c + '"></div>' +
          '<div class="tag ' + (k.me ? 'me' : 'other' + (low++ % 2 ? ' low' : '')) + '" style="left:' + at + '%">' + esc(k.nm) + '</div>';
      });
      h += '</div><div class="axis"><span>' + n(lo) + '</span><span>' + n(hi) + '</span></div>';
      left += card(lbl('Where you sat in gameweek ' + n(a.reportGameweek)) + h);
    }

    if (d.form && d.form.length) {
      var mx = Math.max.apply(null, d.form.map(function (x) { return Math.max(x.points, x.average); }).concat([1]));
      left += card(lbl('You against the Clashd average') +
        '<div class="formbars">' + d.form.map(function (x) {
          return '<div class="b"><div class="n num">' + n(x.points) + '</div>' +
            '<i class="' + (x.aboveAverage ? 'up' : '') + '" style="height:' + Math.round(x.points / mx * 150) + 'px"></i>' +
            '<div class="g">GW' + n(x.gameweek) + '</div></div>';
        }).join('') + '</div>' +
        '<div class="note">Green is a week you beat the platform average.</div>');
    }

    if (d.attribution) {
      var cols = { GK: '#6F8A7C', DEF: '#2E7D55', MID: C.green, FWD: C.bright };
      var tot = Object.keys(d.attribution).reduce(function (t, k) { return t + d.attribution[k]; }, 0) || 1;
      left += card(lbl('Where your points came from') +
        '<div class="stack">' + Object.keys(d.attribution).map(function (k) {
          return '<div style="width:' + (d.attribution[k] / tot * 100) + '%;background:' + cols[k] + '"></div>';
        }).join('') + '</div>' +
        '<div class="legend">' + Object.keys(d.attribution).map(function (k) {
          return '<span><i style="background:' + cols[k] + '"></i>' + k + ' ' + d.attribution[k] + '</span>';
        }).join('') + '</div>');
    }

    var right = '';
    if (d.decisiveCall && d.decisiveCall.message) {
      right += card(lbl('The call that decided it') + '<h3>' + esc(d.decisiveCall.message) + '</h3>' +
        (d.leftBehind ? '<div class="note">Bench ' + n(d.leftBehind.bench) + ' &middot; captain ' +
          n(d.leftBehind.captainMiss) + ' &middot; hits ' + n(d.leftBehind.hits) + '</div>' : ''));
    }
    if (a.lever) {
      right += card(lbl('Your biggest lever') + '<h3>' + n(a.lever.benchTotal) + ' points on the bench</h3>' +
        '<div class="note">' + esc(a.lever.message || '') + ' ' + ordinal(a.lever.rankInDivision) + ' of ' +
        n(a.lever.divisionSize) + ' in your division.</div>');
    }
    if (c && has(c.swing)) {
      right += card(lbl('Consistency') + '<h3>' + esc(c.label || '') + '</h3>' +
        '<div class="note">Best ' + n(c.best) + ', worst ' + n(c.worst) + ', a swing of ' + n(c.swing) + '.</div>');
    }
    if (a.chips && a.chips.rivalsHolding) {
      right += card(lbl('Chips your rivals hold') + rowsBox(a.chips.rivalsHolding.map(function (ch) {
        return '<div class="row"><div class="who"><b>' + esc(ch.label) + '</b></div>' +
          '<div class="xp num" style="font-size:18px">' + n(ch.count) + ' of ' + n(a.chips.rivalCount) + '</div></div>';
      }).join('')));
    }
    return { left: left, right: right, title: 'Analysis', when: 'Gameweek ' + n(a.reportGameweek) + ', look back' };
  }

  function viewAnalysisAhead() {
    var p = state.d.plan || {};
    if (!p.ready) return { left: empty('The next gameweek has not been forecast yet.'), right: '', title: 'Analysis', when: '' };
    var m = p.match || {}, cap = p.captain || {}, tr = p.transfers || {}, ch = p.chips || {};

    var left = card(lbl('Gameweek ' + n(p.gameweek) + ' against ' + (m.opponent || '')) +
      '<h3>' + esc(m.verdict || '') + '</h3>' +
      '<div class="note">' + esc(m.detail || '') + '</div>' +
      '<div class="split" style="margin-top:16px">' +
      '<div><div class="n num">' + n(m.me) + '</div><div class="k">You</div></div>' +
      '<div><div class="n num" style="color:' + C.green + '">' + n(m.winChance) + '%</div><div class="k">Win chance</div></div>' +
      '<div><div class="n num">' + n(m.them) + '</div><div class="k">Them</div></div></div>' +
      (m.sharedCount ? '<div class="tiny" style="margin-top:12px">You both own ' + n(m.sharedCount) +
        ' players worth ' + n(m.sharedXp) + ' forecast points, which cancel out.</div>' : ''));

    if (m.mine && m.mine.length) {
      left += card(lbl('What decides it') +
        '<div class="two-lists"><div>' + lbl('Yours alone') + rowsBox(m.mine.map(function (x) {
          return '<div class="row"><div class="who"><b>' + esc(x.name) + '</b><small>' + esc(x.fixture || '') + '</small></div>' +
            '<div class="xp num">' + n(x.xp) + '</div></div>';
        }).join('')) + '</div><div>' + lbl('Theirs alone') + rowsBox((m.theirs || []).map(function (x) {
          return '<div class="row"><div class="who"><b>' + esc(x.name) + '</b><small>' + esc(x.fixture || '') + '</small></div>' +
            '<div class="xp num">' + n(x.xp) + '</div></div>';
        }).join('')) + '</div></div>');
    }

    if (cap.list && cap.list.length) {
      left += card(lbl('Captain') + '<div class="note" style="margin:6px 0 4px">' + esc(cap.reason || '') + '</div>' +
        rowsBox(cap.list.map(function (x) {
          var kind = x.tag === 'SAFE' ? 'good' : x.tag === 'GAIN' ? 'gain' : 'flat';
          return '<div class="row"><div class="who"><b>' + esc(x.name) + '</b><small>' + esc(x.fixture || '') + '</small></div>' +
            (x.tag ? '<span class="chip ' + kind + '">' + esc(x.tag) + '</span>' : '') +
            '<div class="xp num">' + n(x.xp) + '</div></div>';
        }).join('')));
    }

    var right = '';
    if (tr.best && tr.best.out && tr.best['in']) {
      right += card(lbl('Best transfer') +
        '<h3>' + esc(tr.best.out.name) + ' to ' + esc(tr.best['in'].name) + '</h3>' +
        '<div class="note">Gains ' + n(tr.best.gain) + ' over five gameweeks. ' +
        (has(tr.best.cost) ? 'Costs ' + n(tr.best.cost) + 'm. ' : '') +
        (has(tr.best.rivalsOwn) ? n(tr.best.rivalsOwn) + ' of your rivals already own him.' : '') + '</div>' +
        (tr.hitVerdict ? '<div class="tiny" style="margin-top:10px"><b>Hit?</b> ' + esc(tr.hitVerdict) + '</div>' : '') +
        '<div class="tiny" style="margin-top:8px">Bank ' + n(tr.bank) + 'm &middot; ' + n(tr.freeTransfers) + ' free</div>');
    }
    if (ch.mine && ch.mine.length) {
      right += card(lbl('Chips') + rowsBox(ch.mine.map(function (x) {
        return '<div class="row"><div class="who"><b>' + esc(x.label) + '</b></div>' +
          '<div class="tiny">' + (x.available ? 'Held' : 'Used') + '</div></div>';
      }).join('')) + (typeof ch.risk === 'string' ? '<div class="note">' + esc(ch.risk) + '</div>' : ''));
    }
    if (p.squad) {
      right += card(lbl('Squad outlook') + '<h3>' + n(p.squad.score) + ' / 100</h3>' +
        '<div class="note">' + ordinal(p.squad.rank) + ' of ' + n(p.squad.of) + ' in your division.</div>');
    }
    return { left: left, right: right, title: 'Analysis', when: 'Gameweek ' + n(p.gameweek) + ', plan ahead' };
  }

  function viewAnalysis() {
    var v = state.mode === 'ahead' ? viewAnalysisAhead() : viewAnalysisBack();
    v.left = toggle() + v.left;
    return v;
  }

  // ── profile ──────────────────────────────────────────────────
  function viewProfile() {
    var me = state.d.me || {}, s = state.d.summary || {}, notes = state.d.notes || [];
    var left = card(lbl('Your account') +
      '<h3>' + esc(me.displayName || '') + '</h3>' +
      rowsBox(
        row('Email', me.email) +
        row('FPL team', me.fplTeamName) +
        row('FPL Team ID', me.fplTeamId) +
        row('Linked', me.fplVerifiedAt ? new Date(me.fplVerifiedAt).toLocaleDateString('en-GB') : 'Not linked') +
        row('Season points', me.totalPoints) +
        row('Clashd rank', ordinal(me.platformRank)) +
        (me.role === 'ADMIN' ? row('Role', 'Admin') : '')
      ));

    if (notes && notes.length) {
      left += card(lbl('Recent alerts') + rowsBox(notes.slice(0, 8).map(function (x) {
        return '<div class="row"><div class="who"><b>' + esc(x.title || '') + '</b><small>' + esc(x.body || '') + '</small></div>' +
          '<div class="tiny">' + (x.createdAt ? new Date(x.createdAt).toLocaleDateString('en-GB') : '') + '</div></div>';
      }).join('')));
    }

    var right = card(lbl('Notifications and settings') +
      '<div class="note" style="margin-top:6px">Alert settings, your badge and account deletion live in the app. ' +
      'The web app is read-only for now.</div>') +
      card(lbl('Session') + '<div class="note" style="margin-top:6px">Signed in on this browser. ' +
        'Use Sign out in the corner to end it.</div>');
    return { left: left, right: right, title: 'Profile', when: esc(s.team || me.fplTeamName || '') };
  }
  function row(k, v) {
    return '<div class="row"><div class="who"><b>' + esc(k) + '</b></div><div class="tiny">' + esc(has(v) ? v : '—') + '</div></div>';
  }

  // ── render ───────────────────────────────────────────────────
  function render() {
    var v;
    if (state.loading) v = { left: empty('Loading your gameweek.'), right: '', title: 'Clashd', when: '' };
    else if (state.error) v = { left: card(lbl('Could not load') + '<div class="note">' + esc(state.error) + '</div>'), right: '', title: 'Clashd', when: '' };
    else if (state.view === 'leagues') v = viewLeagues();
    else if (state.view === 'aside') v = viewAside();
    else if (state.view === 'analysis') v = viewAnalysis();
    else if (state.view === 'profile') v = viewProfile();
    else v = viewHome();

    $('viewTitle').textContent = v.title;
    $('viewWhen').innerHTML = v.when || '';
    var me = state.d.me || {}, s = state.d.summary || {};
    $('whoName').textContent = s.team || me.fplTeamName || 'Your team';
    $('whoSub').textContent = me.displayName || '';

    var page = $('page');
    page.innerHTML = '<div class="col">' + v.left + '</div><div class="col">' + (v.right || '') + '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.rail nav a'), function (a) {
      a.classList.toggle('on', a.getAttribute('data-view') === state.view);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.seg-toggle button'), function (b) {
      b.addEventListener('click', function () { state.mode = b.getAttribute('data-mode'); render(); });
    });
    tick();
  }

  function route() {
    var h = (location.hash || '').replace('#/', '');
    state.view = VIEWS.indexOf(h) >= 0 ? h : 'home';
    if (state.view === 'analysis' && state.d.analysis && state.d.analysis.defaultMode === 'plan') state.mode = 'ahead';
    $('shell').classList.remove('open');
    if (!$('shell').classList.contains('hide')) render();
  }
  window.addEventListener('hashchange', route);

  // ── countdown, from the deadline the backend gives us ────────
  function tick() {
    var p = state.d.plan || {};
    var dl = p.deadline || window.CLASHD_DEADLINE;
    var ms = new Date(dl).getTime() - Date.now();
    if (!isFinite(ms)) return;
    if (ms < 0) ms = 0;
    var mins = Math.floor(ms / 60000);
    $('cDays').textContent = Math.floor(mins / 1440);
    $('cHrs').textContent = String(Math.floor(mins % 1440 / 60)).padStart(2, '0');
    $('cMin').textContent = String(mins % 60).padStart(2, '0');
  }
  setInterval(tick, 30000);

  route();
  if (token) start();
})();
