/* ==========================================================================
   Clashd on the web
   Home, Leagues, Aside, Analysis and Profile, read from the same endpoints
   the phone app uses. Real values only: anything the API does not return
   shows as a dash, never as a made-up number.
   ========================================================================== */
(function () {
  'use strict';

  var API = window.CLASHD_API || '';
  var TOKEN_KEY = 'clashd.token';
  var token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }

  var VIEWS = ['home', 'leagues', 'aside', 'analysis', 'profile'];
  var state = { view: 'home', mode: 'back', loading: true, error: null, d: {} };

  var C = { green: '#0E7A3C', live: '#35CE78', gold: '#E8B22E', red: '#BE3229',
            grey: '#A9BAB1', mute: '#5C6D64', turf: '#0A1F16' };

  /* ── helpers ─────────────────────────────────────────────────── */
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
  function lbl(t) { return '<div class="lbl">' + esc(t) + '</div>'; }

  function sec(label, inner, extra) {
    return '<section class="sec"><div class="sec-h">' + lbl(label) +
      (extra ? '<div class="x">' + extra + '</div>' : '') + '</div>' + inner + '</section>';
  }
  function figs(items) {
    return '<div class="figs">' + items.map(function (f) {
      return '<div><div class="v num' + (f.up ? ' up' : '') + '">' + esc(f.v) +
        (f.unit ? '<small>' + esc(f.unit) + '</small>' : '') + '</div>' +
        '<div class="k lbl">' + esc(f.k) + '</div>' +
        (f.note ? '<div class="note" style="margin-top:4px">' + esc(f.note) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function table(cols, rows) {
    if (!rows) return '';
    return '<table class="tbl"><thead><tr>' + cols.map(function (c) {
      return '<th' + (c.r ? ' class="r"' : '') + (c.w ? ' style="width:' + c.w + '"' : '') + '>' + esc(c.t) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function formStrip(arr) {
    if (!arr || !arr.length) return '';
    return '<div class="form-strip">' + arr.map(function (r) {
      var k = r === 'W' ? 'w' : r === 'L' ? 'l' : 'd';
      return '<i class="' + k + '">' + esc(r) + '</i>';
    }).join('') + '</div>';
  }
  function inset(label, head, body, meta, kind) {
    return '<div class="inset' + (kind ? ' ' + kind : '') + '">' + lbl(label) +
      '<h4 style="margin-top:6px">' + esc(head) + '</h4>' +
      (body ? '<p>' + esc(body) + '</p>' : '') +
      (meta ? '<div class="meta">' + meta + '</div>' : '') + '</div>';
  }
  function chart(items, avg) {
    if (!items.length) return '';
    var vals = items.map(function (x) { return Number(x.v) || 0; });
    var max = Math.max.apply(null, vals.concat([Number(avg) || 0, 1]));
    var cols = items.map(function (x) {
      var pc = (Number(x.v) || 0) / max * 86;
      var cls = x.hi ? ' hi' : x.lo ? ' lo' : '';
      return '<div class="c"><div class="v" style="bottom:calc(' + pc.toFixed(1) + '% + 5px)">' + n(x.v) + '</div>' +
        '<i class="' + cls.trim() + '" style="height:' + pc.toFixed(1) + '%"></i></div>';
    }).join('');
    var line = has(avg) ? '<div class="avg" style="bottom:' + ((Number(avg) / max) * 86).toFixed(1) +
      '%"><span>Average ' + n(avg) + '</span></div>' : '';
    return '<div class="chart">' + line + '<div class="cols">' + cols + '</div></div>' +
      '<div class="xax">' + items.map(function (x) { return '<span>' + esc(x.k) + '</span>'; }).join('') + '</div>';
  }
  function bandFigs(items) {
    return '<div class="band-figs">' + items.map(function (f) {
      return '<div><div class="v">' + esc(f.v) + (f.unit ? '<small>' + esc(f.unit) + '</small>' : '') +
        '</div><div class="k">' + esc(f.k) + '</div></div>';
    }).join('') + '</div>';
  }
  function clock() {
    return '<div class="clock">' +
      '<div class="seg"><div class="k">Days</div><div class="v" id="cDays">—</div></div>' +
      '<div class="seg"><div class="k">Hrs</div><div class="v" id="cHrs">—</div></div>' +
      '<div class="seg"><div class="k">Min</div><div class="v" id="cMin">—</div></div>' +
      '<div class="until"><div class="k">Until</div><div class="v">Deadline</div></div></div>';
  }
  function bandTop(eyebrow, title, strap, withClock) {
    return '<div class="band-top"><div style="min-width:0">' + lbl(eyebrow) +
      (title ? '<h1>' + esc(title) + '</h1>' : '') +
      (strap ? '<div class="strap">' + esc(strap) + '</div>' : '') + '</div>' +
      (withClock ? clock() : '') + '</div>';
  }
  function empty(msg) { return sec('Nothing yet', '<p>' + esc(msg) + '</p>'); }

  /* ── api ─────────────────────────────────────────────────────── */
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

  /* ── sign in ─────────────────────────────────────────────────── */
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
  $('scrim').addEventListener('click', function () { $('shell').classList.remove('open'); });

  /* ── load ────────────────────────────────────────────────────── */
  function start() {
    $('signin').classList.add('hide');
    $('shell').classList.remove('hide');
    document.title = 'Clashd';
    state.loading = true; state.error = null;
    render();
    Promise.all([
      api('/api/auth/me'),
      soft('/api/summary'), soft('/api/leagues'),
      soft('/api/analysis'), soft('/api/analysis/plan'), soft('/api/notifications')
    ]).then(function (r) {
      state.d = { me: r[0], summary: r[1], leagues: r[2], analysis: r[3], plan: r[4], notes: r[5] };
      state.loading = false;
      if (state.view === 'analysis' && state.d.analysis && state.d.analysis.defaultMode === 'plan') state.mode = 'ahead';
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

  /* ── home ────────────────────────────────────────────────────── */
  function viewHome() {
    var s = state.d.summary || {}, p = state.d.plan || {}, a = state.d.analysis || {};
    var f = s.nextFixture || {}, m = p.match || {};
    var hits = n(s.hits, 0);

    /* the band is the fixture */
    var band;
    if (f.opponent) {
      var live = f.live && (has(f.myScore) || has(f.opponentScore));
      var mine = live ? n(f.myScore) : n(m.me);
      var thrs = live ? n(f.opponentScore) : n(m.them);
      var unit = live ? 'Live' : (has(m.me) ? 'Forecast' : 'Not started');

      band = bandTop('Gameweek ' + n(f.gameweek) + (f.division ? ' · ' + f.division + ' division' : ''), '', '', true) +
        '<div class="md">' +
          '<div class="side"><div class="t">' + esc(s.team || 'Your team') + '</div>' +
            '<div class="sc">' + mine + '</div>' +
            '<div class="u">' + esc(unit) + '</div>' + formStrip(s.form) + '</div>' +
          '<div class="vs' + (live ? ' live' : '') + '">' + (live ? 'Live' : 'versus') + '</div>' +
          '<div class="side away"><div class="t">' + esc(f.opponent) + '</div>' +
            '<div class="sc">' + thrs + '</div>' +
            '<div class="u">' + esc(unit) + '</div>' + formStrip(f.opponentForm) + '</div>' +
        '</div>';

      if (has(m.winChance)) {
        var w = Math.max(0, Math.min(100, Number(m.winChance)));
        band += '<div class="odds"><div class="tr">' +
          '<i class="mine" style="width:' + w + '%"></i><i class="theirs" style="width:' + (100 - w) + '%"></i></div>' +
          '<div class="cap"><span><b>' + w + '%</b>you win</span>' +
          '<span><b>' + (100 - w) + '%</b>' + esc(f.opponent) + '</span></div></div>';
      }
    } else {
      band = bandTop('Clashd', s.team || 'Your team',
        'Your next fixture appears when the division is drawn.', true);
    }

    /* the sheet */
    var body = sec('This week', figs([
      { v: n(s.gameweekPoints), k: 'Gameweek ' + n(s.currentGameweek),
        note: hits ? 'Net, after a ' + hits + ' point hit' : 'Net score' },
      { v: n(s.seasonPoints), k: 'Season', note: 'Points so far' },
      { v: ordinal(s.platformRank), k: 'On Clashd',
        up: has(s.rankMove) && s.rankMove > 0,
        note: has(s.rankMove) && s.rankMove !== 0
          ? (s.rankMove > 0 ? 'Up ' + s.rankMove + ' this week' : 'Down ' + Math.abs(s.rankMove) + ' this week')
          : 'Across every manager' },
      { v: n(s.gameweekHigh), k: 'Weekly high', note: 'Best score on Clashd this week' }
    ]));

    var series = s.pointsSeries || [];
    if (series.length) {
      var best = (s.bestGw || {}).gameweek, worst = (s.worstGw || {}).gameweek;
      var avg = Number(s.avgPoints) || 0;
      body += sec('Your season, gameweek by gameweek',
        chart(series.map(function (x) {
          return { v: x.points, k: 'GW' + x.gameweek, hi: x.gameweek === best, lo: x.points < avg };
        }), s.avgPoints),
        'Best ' + n((s.bestGw || {}).points) + ' in GW' + n(best) +
        ' · worst ' + n((s.worstGw || {}).points) + ' in GW' + n(worst));
    }

    if (p.ready && m.verdict) {
      var side = '';
      if (p.captain && p.captain.pick) {
        side += inset('Captain for gameweek ' + n(p.gameweek), p.captain.pick.name,
          p.captain.pick.why || p.captain.reason || '', '', 'gold');
      }
      if (a.stakes && a.stakes.message) {
        side += '<div style="margin-top:14px">' +
          inset('What is at stake', a.stakes.division || '', a.stakes.message) + '</div>';
      }
      body += sec('Gameweek ' + n(p.gameweek) + ', what the forecast says',
        '<div class="two"><div>' +
          '<h3>' + esc(m.verdict) + '</h3>' +
          (m.detail ? '<p>' + esc(m.detail) + '</p>' : '') +
          (m.sharedCount ? '<p class="tiny" style="margin-top:12px">You both own ' + n(m.sharedCount) +
            ' players worth ' + n(m.sharedXp) + ' forecast points, which cancel out.</p>' : '') +
        '</div><div>' + side + '</div></div>');
    }

    var mine2 = s.leagues || [];
    if (mine2.length) {
      body += sec('Your competitions', table(
        [{ t: '', w: '38px' }, { t: 'Competition' }, { t: 'Field', r: true }, { t: 'Points', r: true }],
        mine2.slice(0, 6).map(leagueRow).join('')),
        mine2.length > 6 ? '<a href="#/leagues">All ' + mine2.length + '</a>' : '');
    }

    return { band: band, body: body, title: 'Home' };
  }

  function leagueRow(l) {
    var place = has(l.tablePosition) ? l.tablePosition : l.position;
    var of = has(l.tableTotal) ? l.tableTotal : l.total;
    var delta = has(l.rankDelta) && l.rankDelta !== 0
      ? '<span class="dl ' + (l.rankDelta > 0 ? 'up' : 'dn') + '">' +
        (l.rankDelta > 0 ? '+' : '−') + Math.abs(l.rankDelta) + '</span>' : '';
    var pts = has(l.leaguePoints) && l.leaguePoints ? l.leaguePoints : l.points;
    return '<tr' + (Number(place) === 1 ? ' class="lead"' : '') + '>' +
      '<td class="pos">' + n(place) + '</td>' +
      '<td><span class="nm">' + esc(l.name) + '</span>' +
      (l.division ? '<span class="sub">' + esc(l.division) + ' division</span>' : '') + '</td>' +
      '<td class="r"><span class="v q">of ' + n(of) + '</span>' + delta + '</td>' +
      '<td class="r"><span class="v">' + n(pts) + '</span></td></tr>';
  }

  /* ── leagues ─────────────────────────────────────────────────── */
  function viewLeagues() {
    var s = state.d.summary || {}, all = state.d.leagues || [], a = state.d.analysis || {};
    var mine = s.leagues || [];
    if (!mine.length && !all.length) {
      return { band: bandTop('Leagues', 'No competitions yet', 'Join your first competition in the app.', true),
               body: '', title: 'Leagues' };
    }

    var st = a.stakes || {};
    var band = bandTop('Clashd Premier League', st.division ? st.division + ' division' : 'Your competitions',
      st.message || '', true);
    band += bandFigs([
      { v: ordinal(st.position), k: 'Your position' },
      { v: n(st.total), k: 'Managers in division' },
      { v: mine.length, k: 'Competitions entered' },
      { v: n(s.seasonPoints), k: 'Season points' }
    ]);

    var body = sec('Every competition you are in', table(
      [{ t: '', w: '38px' }, { t: 'Competition' }, { t: 'Field', r: true }, { t: 'Points', r: true }],
      mine.map(leagueRow).join('')));

    if (a.h2h && a.h2h.length) {
      var won = a.h2h.filter(function (h) { return h.w; }).length;
      var lost = a.h2h.filter(function (h) { return h.l; }).length;
      body += sec('Head to head', table(
        [{ t: 'Opponent' }, { t: 'Score', r: true }, { t: 'Result', r: true }],
        a.h2h.map(function (h) {
          var res = h.w ? 'Won' : h.l ? 'Lost' : 'Drew';
          var kind = h.w ? 'good' : h.l ? 'warn' : 'flat';
          return '<tr><td><span class="nm">' + esc(h.opponent) + '</span></td>' +
            '<td class="r"><span class="v">' + n(h['for']) + ' – ' + n(h.against) + '</span></td>' +
            '<td class="r"><span class="tag-chip ' + kind + '">' + res + '</span></td></tr>';
        }).join('')),
        won + ' won · ' + lost + ' lost · ' + (a.h2h.length - won - lost) + ' drawn');
    }

    var meta = {};
    (all || []).forEach(function (l) { meta[l.id] = l; });
    var notJoined = (all || []).filter(function (l) { return !l.joined; });
    if (notJoined.length) {
      body += sec('Open to join', table(
        [{ t: 'Competition' }, { t: 'Entered', r: true }],
        notJoined.map(function (l) {
          return '<tr><td><span class="nm">' + esc(l.name) + '</span>' +
            (l.description ? '<span class="sub">' + esc(l.description) + '</span>' : '') + '</td>' +
            '<td class="r"><span class="v q">' + n(l.entryCount) + '</span></td></tr>';
        }).join('')) + '<p class="note">Joining happens in the app.</p>');
    }

    return { band: band, body: body, title: 'Leagues' };
  }

  /* ── aside ───────────────────────────────────────────────────── */
  function viewAside() {
    var p = state.d.plan || {}, sq = p.squad || {}, players = sq.players || [];
    if (!players.length) {
      return { band: bandTop('Aside', 'No squad yet',
        'Your squad appears here once the next gameweek is forecast.', true), body: '', title: 'Aside' };
    }
    var order = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
    var starters = players.filter(function (x) { return x.starter; })
      .sort(function (x, y) { return (order[x.position] - order[y.position]) || (y.xp - x.xp); });
    var bench = players.filter(function (x) { return !x.starter; });
    var total = starters.reduce(function (t, x) { return t + (Number(x.xp) || 0); }, 0);

    var band = bandTop('Gameweek ' + n(p.gameweek), 'Your aside',
      'Seven from your eleven. Picks lock at the FPL deadline.', true);
    band += bandFigs([
      { v: total.toFixed(1), k: 'Eleven, forecast points' },
      { v: n(sq.score), unit: '/100', k: 'Squad strength' },
      { v: ordinal(sq.rank), k: 'Of ' + n(sq.of) + ' in your division' }
    ]);

    function playerRow(x) {
      var doubt = x.status && x.status !== 'a';
      var bits = [x.team, x.fixture].filter(function (y) { return has(y); }).map(esc).join(' · ');
      return '<tr><td class="pos">' + esc(x.position || '') + '</td>' +
        '<td><span class="nm">' + esc(x.name) + '</span>' +
        (bits ? '<span class="sub">' + bits + '</span>' : '') + '</td>' +
        '<td class="r">' + (doubt ? '<span class="tag-chip warn">Doubt</span>' : '') + '</td>' +
        '<td class="r"><span class="v">' + (has(x.xp) ? Number(x.xp).toFixed(1) : '—') + '</span></td></tr>';
    }

    var body = sec('Your eleven', table(
      [{ t: '', w: '44px' }, { t: 'Player' }, { t: '', r: true }, { t: 'Forecast', r: true }],
      starters.map(playerRow).join('')));

    if (bench.length) {
      body += sec('Your bench', table(
        [{ t: '', w: '44px' }, { t: 'Player' }, { t: '', r: true }, { t: 'Forecast', r: true }],
        bench.map(playerRow).join('')));
    }

    var side = '';
    if (sq.weakest) {
      side += inset('Weakest link', sq.weakest.name,
        (sq.weakest.team || '') + ' · ' + n(sq.weakest.xp) + ' expected over the run, ' +
        n(sq.weakest.pct) + '% of the best in his position.', '', 'red');
    }
    body += sec('Squad strength',
      '<div class="two"><div>' +
        '<h3>' + n(sq.score) + ' out of 100, ' + ordinal(sq.rank) + ' of ' + n(sq.of) + '</h3>' +
        (sq.ahead && sq.ahead.length
          ? '<p>Ahead of you in the division: ' + esc(sq.ahead.join(', ')) + '.</p>' : '') +
        '<p class="note">Aside picks are made in the app for now. Picking from the web is the next thing we add.</p>' +
      '</div><div>' + side + '</div></div>');

    return { band: band, body: body, title: 'Aside' };
  }

  /* ── analysis ────────────────────────────────────────────────── */
  function toggle() {
    return '<div class="seg-toggle">' +
      '<button type="button" data-mode="back" class="' + (state.mode === 'back' ? 'on' : '') + '">Look back</button>' +
      '<button type="button" data-mode="ahead" class="' + (state.mode === 'ahead' ? 'on' : '') + '">Plan ahead</button></div>';
  }

  function viewAnalysisBack() {
    var a = state.d.analysis || {}, d = a.dashboard || {};
    if (!a.ready) {
      return { band: bandTop('Analysis', 'Not scored yet',
        'Your report appears once the gameweek has been scored.', true) + toggle(), body: '', title: 'Analysis' };
    }
    var f = d.field || {}, e = d.efficiency || {}, c = d.consistency || {}, b = a.benchmarks || {};

    var band = bandTop('Gameweek ' + n(a.reportGameweek) + ', look back',
      (d.decisiveCall && d.decisiveCall.message) || 'Your gameweek', '', true);
    band += bandFigs([
      { v: n(a.rating), unit: '/10', k: 'Gameweek rating' },
      { v: n(e.pct), unit: '%', k: 'Efficiency' },
      { v: ordinal(d.percentile), k: 'Percentile on Clashd' },
      { v: n(c.rate), k: 'Points per gameweek' }
    ]);
    band += toggle();

    var body = '';

    if (has(f.myScore)) {
      var lo = Math.min(f.lowest, f.myScore), hi = Math.max(f.highest, f.myScore);
      var span = Math.max(1, hi - lo);
      var marks = [
        { nm: 'Lowest ' + n(f.lowest), v: f.lowest, c: C.grey },
        { nm: 'Clashd average ' + n(f.average), v: f.average, c: C.mute },
        { nm: 'Your division ' + n(b.divisionAvg), v: b.divisionAvg, c: C.green },
        { nm: 'Top 30 ' + n(b.topAvg), v: b.topAvg, c: C.gold },
        { nm: 'You ' + n(f.myScore), v: f.myScore, c: C.turf, me: true },
        { nm: 'Highest ' + n(f.highest), v: f.highest, c: C.grey }
      ].filter(function (k) { return has(k.v); }).sort(function (x, y) { return x.v - y.v; });
      var h = '<div class="scale"><div class="track"></div>', low = 0;
      marks.forEach(function (k) {
        var at = (k.v - lo) / span * 100;
        h += '<div class="mark" style="left:' + at + '%;background:' + k.c + '"></div>' +
          '<div class="tag ' + (k.me ? 'me' : 'other' + (low++ % 2 ? ' low' : '')) + '" style="left:' + at + '%">' +
          esc(k.nm) + '</div>';
      });
      h += '</div>';
      body += sec('Where you sat in gameweek ' + n(a.reportGameweek), h,
        'Every Clashd manager, lowest to highest');
    }

    body += sec('What you left behind',
      '<div class="two"><div>' +
        '<h3>' + n(e.actual) + ' of a possible ' + n(e.possible) + ' points, ' + n(e.pct) + '% efficient</h3>' +
        (d.leftBehind
          ? '<p>' + n(d.leftBehind.bench) + ' points sat on your bench, the captain armband cost ' +
            n(d.leftBehind.captainMiss) + ', and hits cost ' + n(d.leftBehind.hits) + '.</p>' : '') +
      '</div><div>' +
        (a.lever ? inset('Your biggest lever', n(a.lever.benchTotal) + ' points on the bench',
          a.lever.message || '', ordinal(a.lever.rankInDivision) + ' of ' + n(a.lever.divisionSize) +
          ' in your division') : '') +
      '</div></div>');

    if (d.form && d.form.length) {
      var avg = d.form.reduce(function (t, x) { return t + (Number(x.average) || 0); }, 0) / d.form.length;
      body += sec('You against the Clashd average',
        chart(d.form.map(function (x) {
          return { v: x.points, k: 'GW' + x.gameweek, lo: !x.aboveAverage };
        }), Math.round(avg)),
        'Solid green is a week you beat the platform average');
    }

    if (d.attribution) {
      var cols = { GK: '#6F8A7C', DEF: '#2E7D55', MID: C.green, FWD: C.live };
      var keys = Object.keys(d.attribution);
      var tot = keys.reduce(function (t, k) { return t + d.attribution[k]; }, 0) || 1;
      body += sec('Where your points came from',
        '<div class="stack">' + keys.map(function (k) {
          return '<div style="width:' + (d.attribution[k] / tot * 100) + '%;background:' + (cols[k] || C.grey) + '"></div>';
        }).join('') + '</div>' +
        '<div class="legend">' + keys.map(function (k) {
          return '<span><i style="background:' + (cols[k] || C.grey) + '"></i>' + esc(k) + ' ' + d.attribution[k] + '</span>';
        }).join('') + '</div>');
    }

    var tail = '';
    if (c && has(c.swing)) {
      tail += '<div><h3>' + esc(c.label || '') + '</h3>' +
        '<p>Best ' + n(c.best) + ', worst ' + n(c.worst) + ', a swing of ' + n(c.swing) +
        ' points between your highest and lowest week.</p></div>';
    }
    if (a.chips && a.chips.rivalsHolding) {
      tail += '<div>' + lbl('Chips your rivals still hold') + table(
        [{ t: 'Chip' }, { t: 'Held by', r: true }],
        a.chips.rivalsHolding.map(function (ch) {
          return '<tr><td><span class="nm">' + esc(ch.label) + '</span></td>' +
            '<td class="r"><span class="v">' + n(ch.count) + '</span>' +
            '<span class="v q"> of ' + n(a.chips.rivalCount) + '</span></td></tr>';
        }).join('')) + '</div>';
    }
    if (tail) body += sec('Consistency and what is left in the locker', '<div class="even">' + tail + '</div>');

    return { band: band, body: body, title: 'Analysis' };
  }

  function viewAnalysisAhead() {
    var p = state.d.plan || {};
    if (!p.ready) {
      return { band: bandTop('Analysis', 'Not forecast yet',
        'The next gameweek has not been forecast yet.', true) + toggle(), body: '', title: 'Analysis' };
    }
    var m = p.match || {}, cap = p.captain || {}, tr = p.transfers || {}, ch = p.chips || {};

    var band = bandTop('Gameweek ' + n(p.gameweek) + (m.opponent ? ' against ' + m.opponent : '') + ', plan ahead',
      m.verdict || '', m.detail || '', true);
    if (has(m.winChance)) {
      var w = Math.max(0, Math.min(100, Number(m.winChance)));
      band += '<div class="odds"><div class="tr">' +
        '<i class="mine" style="width:' + w + '%"></i><i class="theirs" style="width:' + (100 - w) + '%"></i></div>' +
        '<div class="cap"><span><b>' + n(m.me) + '</b>you, forecast</span>' +
        '<span><b>' + w + '%</b>win chance</span>' +
        '<span><b>' + n(m.them) + '</b>' + esc(m.opponent || 'them') + '</span></div></div>';
    }
    band += toggle();

    var body = '';

    if (m.mine && m.mine.length) {
      function xpRow(x) {
        return '<tr><td><span class="nm">' + esc(x.name) + '</span>' +
          (x.fixture ? '<span class="sub">' + esc(x.fixture) + '</span>' : '') + '</td>' +
          '<td class="r"><span class="v">' + n(x.xp) + '</span></td></tr>';
      }
      body += sec('What decides it',
        '<div class="even"><div>' + lbl('Yours alone') +
          table([{ t: 'Player' }, { t: 'Forecast', r: true }], m.mine.map(xpRow).join('')) +
        '</div><div>' + lbl('Theirs alone') +
          table([{ t: 'Player' }, { t: 'Forecast', r: true }], (m.theirs || []).map(xpRow).join('')) +
        '</div></div>',
        m.sharedCount ? n(m.sharedCount) + ' shared players worth ' + n(m.sharedXp) + ' cancel out' : '');
    }

    if (cap.list && cap.list.length) {
      body += sec('Captain', table(
        [{ t: 'Player' }, { t: '', r: true }, { t: 'Forecast', r: true }],
        cap.list.map(function (x) {
          var kind = x.tag === 'SAFE' ? 'good' : x.tag === 'GAIN' ? 'gain' : 'flat';
          return '<tr><td><span class="nm">' + esc(x.name) + '</span>' +
            (x.fixture ? '<span class="sub">' + esc(x.fixture) + '</span>' : '') + '</td>' +
            '<td class="r">' + (x.tag ? '<span class="tag-chip ' + kind + '">' + esc(x.tag) + '</span>' : '') + '</td>' +
            '<td class="r"><span class="v">' + n(x.xp) + '</span></td></tr>';
        }).join('')), esc(cap.reason || ''));
    }

    var side = '';
    if (ch.mine && ch.mine.length) {
      side += lbl('Your chips') + table([{ t: 'Chip' }, { t: '', r: true }],
        ch.mine.map(function (x) {
          return '<tr><td><span class="nm">' + esc(x.label) + '</span></td>' +
            '<td class="r"><span class="tag-chip ' + (x.available ? 'good' : 'flat') + '">' +
            (x.available ? 'Held' : 'Used') + '</span></td></tr>';
        }).join(''));
      if (typeof ch.risk === 'string') side += '<p class="note">' + esc(ch.risk) + '</p>';
    }

    if (tr.best && tr.best.out && tr.best['in']) {
      body += sec('Transfers',
        '<div class="two"><div>' +
          '<h3>' + esc(tr.best.out.name) + ' to ' + esc(tr.best['in'].name) + '</h3>' +
          '<p>Gains ' + n(tr.best.gain) + ' points over five gameweeks' +
          (has(tr.best.cost) ? ', costs ' + n(tr.best.cost) + 'm' : '') + '. ' +
          (has(tr.best.rivalsOwn) ? n(tr.best.rivalsOwn) + ' of your rivals already own him.' : '') + '</p>' +
          (tr.hitVerdict ? '<p class="note"><b>Worth a hit?</b> ' + esc(tr.hitVerdict) + '</p>' : '') +
          '<p class="tiny mt">Bank ' + n(tr.bank) + 'm · ' + n(tr.freeTransfers) + ' free transfer' +
          (Number(tr.freeTransfers) === 1 ? '' : 's') + '</p>' +
        '</div><div>' + side + '</div></div>');
    } else if (side) {
      body += sec('Chips', side);
    }

    if (p.squad) {
      body += sec('Squad outlook',
        '<h3>' + n(p.squad.score) + ' out of 100, ' + ordinal(p.squad.rank) + ' of ' + n(p.squad.of) + '</h3>' +
        '<p>Measured across your division on forecast points over the next five gameweeks.</p>');
    }

    return { band: band, body: body, title: 'Analysis' };
  }

  function viewAnalysis() {
    return state.mode === 'ahead' ? viewAnalysisAhead() : viewAnalysisBack();
  }

  /* ── profile ─────────────────────────────────────────────────── */
  function viewProfile() {
    var me = state.d.me || {}, s = state.d.summary || {}, notes = state.d.notes || [];

    var band = bandTop('Your account', me.displayName || 'Your account',
      (s.team || me.fplTeamName || '') + (me.fplVerifiedAt ? ', linked to FPL' : ''), true);
    band += bandFigs([
      { v: n(me.totalPoints), k: 'Season points' },
      { v: ordinal(me.platformRank), k: 'Rank on Clashd' },
      { v: n((s.leagues || []).length), k: 'Competitions' }
    ]);

    function pair(k, v) {
      return '<div class="p"><b>' + esc(k) + '</b><span>' + esc(has(v) ? v : '—') + '</span></div>';
    }
    var body = sec('Account', '<div class="two"><div class="pairs">' +
      pair('Email', me.email) +
      pair('FPL team', me.fplTeamName) +
      pair('FPL team ID', me.fplTeamId) +
      pair('Linked', me.fplVerifiedAt ? new Date(me.fplVerifiedAt).toLocaleDateString('en-GB') : 'Not linked') +
      pair('Joined', me.createdAt ? new Date(me.createdAt).toLocaleDateString('en-GB') : '—') +
      (me.role === 'ADMIN' ? pair('Role', 'Admin') : '') +
      '</div><div>' +
      inset('On the web', 'Read only, for now',
        'Alert settings, your badge, joining competitions and account deletion live in the app. ' +
        'Picking your aside from the web is the next thing we add.') +
      '</div></div>');

    if (notes && notes.length) {
      body += sec('Recent alerts', table(
        [{ t: 'Alert' }, { t: 'When', r: true }],
        notes.slice(0, 8).map(function (x) {
          return '<tr><td><span class="nm">' + esc(x.title || '') + '</span>' +
            (x.body ? '<span class="sub">' + esc(x.body) + '</span>' : '') + '</td>' +
            '<td class="r"><span class="v q">' +
            (x.createdAt ? new Date(x.createdAt).toLocaleDateString('en-GB') : '') + '</span></td></tr>';
        }).join('')));
    }

    return { band: band, body: body, title: 'Profile' };
  }

  /* ── render ──────────────────────────────────────────────────── */
  function render() {
    var v;
    if (state.loading) {
      v = { band: bandTop('Clashd', 'Loading your gameweek', '', false), body: '', title: 'Clashd' };
    } else if (state.error) {
      v = { band: bandTop('Clashd', 'Could not load', state.error, false), body: '', title: 'Clashd' };
    } else if (state.view === 'leagues') v = viewLeagues();
    else if (state.view === 'aside') v = viewAside();
    else if (state.view === 'analysis') v = viewAnalysis();
    else if (state.view === 'profile') v = viewProfile();
    else v = viewHome();

    document.title = state.loading ? 'Clashd' : 'Clashd — ' + v.title;

    var me = state.d.me || {}, s = state.d.summary || {};
    $('whoName').textContent = s.team || me.fplTeamName || 'Your team';
    $('whoSub').textContent = me.displayName || '';
    $('railGw').textContent = has(s.currentGameweek) ? 'GW' + s.currentGameweek : '';

    $('band').innerHTML = '<div class="band">' + v.band + '</div>';
    $('page').innerHTML = v.body || '';

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

  /* ── countdown, from the deadline the backend gives us ───────── */
  function tick() {
    var p = state.d.plan || {};
    var dl = p.deadline || window.CLASHD_DEADLINE;
    var ms = new Date(dl).getTime() - Date.now();
    if (!isFinite(ms)) return;
    if (ms < 0) ms = 0;
    var mins = Math.floor(ms / 60000);
    var dEl = $('cDays'), hEl = $('cHrs'), mEl = $('cMin');
    if (!dEl) return;
    dEl.textContent = Math.floor(mins / 1440);
    hEl.textContent = String(Math.floor(mins % 1440 / 60)).padStart(2, '0');
    mEl.textContent = String(mins % 60).padStart(2, '0');
  }
  setInterval(tick, 30000);

  route();
  if (token) start();
})();
