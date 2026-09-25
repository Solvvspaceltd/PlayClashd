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

  var VIEWS = ['home', 'leagues', 'aside', 'analysis', 'news', 'profile'];
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

  /* ── what this account may see, and how that is shown ──────────────
     The server reports source PREVIEW while Analysis is free for everyone.
     That is not the same as having paid, so the padlock is shown either way
     — people learn what is paid before it costs anything, and on the day the
     preview ends nothing on screen changes. */
  function ent() { return state.d.billing || {}; }
  function paying() { var e = ent(); return !!e.pro && e.source !== 'PREVIEW'; }
  function preview() { return ent().source === 'PREVIEW'; }

  function lockBadge(text) {
    return '<span class="lock-badge"><i></i>' + esc(text || 'Clashd Analysis') + '</span>';
  }

  /** Blurred behind glass: the shape is visible, the numbers are not. */
  function veil(inner, head, body) {
    return '<div class="veil"><div class="veil-inner">' + inner + '</div>' +
      '<div class="veil-over">' + lockBadge('Clashd Analysis') +
      '<h4>' + esc(head) + '</h4>' +
      (body ? '<p>' + esc(body) + '</p>' : '') +
      '<p class="tiny">Subscribe in the Clashd app to unlock.</p></div></div>';
  }

  /** The strip at the top of Analysis. Nothing at all once somebody pays. */
  function sell() {
    if (paying()) return '';
    var e = ent();
    var plans = e.plans || [];
    var monthly = plans.filter(function (p) { return p.period === 'month'; })[0];
    var yearly = plans.filter(function (p) { return p.period === 'year'; })[0];

    if (preview()) {
      return '<div class="sell"><div class="row" style="margin-top:0">' +
        lockBadge('Clashd Analysis') +
        '<div class="note" style="margin:0">Everything below is paid from launch. ' +
        'It is open to everyone while Clashd is in preview, so have a proper look at it.</div>' +
        '</div></div>';
    }
    return '<div class="sell">' + lockBadge('Clashd Analysis') +
      '<h3>Every other tool ranks you against ten million strangers.</h3>' +
      '<p>Clashd holds your division\u2019s data, so it answers the only question that decides ' +
      'your week: what do they have that you do not?</p>' +
      '<div class="row">' +
      (monthly ? '<div class="price">' + esc(monthly.price) + '<small>/month</small></div>' : '') +
      (yearly ? '<div class="price">' + esc(yearly.price) + '<small>/year</small></div>' : '') +
      '<div class="note">Subscribe in the Clashd app. Your subscription follows your account here.</div>' +
      '</div></div>';
  }

  /** How many of a sample hold him, drawn rather than written. */
  function pips(on, total, warn) {
    var cap = Math.min(total, 30), lit = Math.round(on / Math.max(1, total) * cap);
    var out = '<span class="pips' + (warn ? ' warn' : '') + '">';
    for (var i = 0; i < cap; i++) out += '<i class="' + (i < lit ? 'on' : '') + '"></i>';
    return out + '</span>';
  }

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
      soft('/api/analysis'), soft('/api/analysis/plan'), soft('/api/notifications'),
      soft('/api/analysis/differentials'), soft('/api/billing/me'), soft('/api/news')
    ]).then(function (r) {
      state.d = { me: r[0], summary: r[1], leagues: r[2], analysis: r[3], plan: r[4], notes: r[5],
                  pack: r[6], billing: r[7], news: r[8] };
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
    /* Two figures, not four. Season total and the week's high are context, so
       they belong in the sentence underneath rather than competing for the eye. */
    var move = has(s.rankMove) && s.rankMove !== 0
      ? (s.rankMove > 0 ? 'up ' + s.rankMove + ' this week' : 'down ' + Math.abs(s.rankMove) + ' this week')
      : 'across every manager';
    var context = has(s.seasonPoints)
      ? n(s.seasonPoints) + ' points for the season' +
        (has(s.gameweekHigh)
          ? ', and the best anyone on Clashd managed this week was ' + n(s.gameweekHigh) + '.'
          : '.')
      : '';

    var body = sec('This week', figs([
      { v: n(s.gameweekPoints), k: 'Gameweek ' + n(s.currentGameweek),
        note: hits ? 'Net, after a ' + hits + ' point hit' : 'Net score' },
      { v: ordinal(s.platformRank), k: 'On Clashd',
        up: has(s.rankMove) && s.rankMove > 0, note: move }
    ]) + (context ? '<p class="note">' + esc(context) + '</p>' : ''));

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
      body += sec('Your competitions', mine2.slice(0, 6).map(leagueRow).join(''),
        mine2.length > 6 ? '<a href="#/leagues">All ' + mine2.length + '</a>' : '');
    }

    return { band: band, body: body, title: 'Home' };
  }

  /**
   * One competition. "1st of 9" is a single fact so it is a single object, and
   * the score carries the name of its own unit — captain points and green
   * arrows sharing a column headed "Points" is what made this page unreadable.
   */
  function leagueRow(l) {
    var place = has(l.tablePosition) ? l.tablePosition : l.position;
    var of = has(l.tableTotal) ? l.tableTotal : l.total;
    var delta = has(l.rankDelta) && l.rankDelta !== 0
      ? '<span class="dl ' + (l.rankDelta > 0 ? 'up' : 'dn') + '">' +
        (l.rankDelta > 0 ? '+' : '\u2212') + Math.abs(l.rankDelta) + '</span>' : '';
    var usesTable = has(l.tablePosition);
    var pts = usesTable ? l.leaguePoints : l.points;
    var unit = usesTable ? 'league points' : unitFor(l, pts);
    return '<div class="lg">' +
      '<div class="place' + (Number(place) === 1 ? ' lead' : '') + '">' + ordinal(place) +
      '<small>of ' + n(of) + '</small>' + delta + '</div>' +
      '<div class="nm">' + esc(l.name) +
      (l.division ? '<em>' + esc(l.division) + ' division</em>' : '') + '</div>' +
      '<div class="score"><b>' + n(pts) + '</b><span>' + esc(unit) + '</span></div>' +
      '</div>';
  }

  /** What this competition actually counts. The API names it; fall back by format. */
  function unitFor(l, v) {
    if (l.scoreLabel) {
      var s = String(l.scoreLabel).toLowerCase();
      if (s === 'green arrows' && Math.abs(Number(v)) === 1) return 'green arrow';
      return s;
    }
    switch (l.format) {
      case 'CAPTAIN_POINTS': return 'captain points';
      case 'NO_HITS':        return 'after hits';
      case 'RANK_CLIMB':     return Math.abs(Number(v)) === 1 ? 'green arrow' : 'green arrows';
      case 'TRANSFER_NET':   return 'net on transfers';
      case 'SEVEN_ASIDE':
      case 'FIVE_ASIDE':     return 'aside points';
      default:               return 'season points';
    }
  }

  /**
   * How to report ownership across a list.
   *
   * Repeating the same fraction down eleven rows is texture. But one outlier
   * should not force it back onto every row either — so the common case is
   * stated once in words and only the exceptions are marked. Below that, the
   * numbers vary enough to be worth reading and they all go back on.
   */
  function ownRule(counts, of) {
    var tally = {};
    counts.forEach(function (c) { tally[c] = (tally[c] || 0) + 1; });
    var modal = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; })[0];
    var share = tally[modal] / counts.length;
    var m = Number(modal);
    if (share < 0.6) return { perRow: true, said: '' };
    return {
      perRow: false,
      modal: m,
      said: m === 0
        ? 'None of the ' + of + ' own any of these.'
        : m + ' of the ' + of + ' own each of these.',
    };
  }

  /** A shortlist drawn against its own best, so the spread is visible. */
  function shortlist(rows, val, label, meta, kind) {
    var top = Math.max.apply(null, rows.map(val).concat([1]));
    return rows.map(function (x, i) {
      var v = val(x);
      return '<div class="sl' + (i === 0 ? ' best' : '') + (kind === 'warn' ? ' warn' : '') + '">' +
        '<div class="r1"><span class="nm">' + esc(x.name) + '</span>' +
        '<span class="meta">' + meta(x) + '</span>' +
        '<span class="val">' + (Math.round(v * 10) / 10) + '</span></div>' +
        '<div class="track"><i style="width:' + Math.max(3, v / top * 100).toFixed(0) + '%"></i></div>' +
        '</div>';
    }).join('') + (label ? '<div class="scale-note">' + esc(label) + '</div>' : '');
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

    var own = mine.filter(function (l) { return !l.imported; });
    var imported = mine.filter(function (l) { return l.imported; });
    var leading = mine.filter(function (l) {
      return Number(has(l.tablePosition) ? l.tablePosition : l.position) === 1;
    }).length;

    var body = '';
    if (own.length) {
      body += sec('Clashd competitions', own.map(leagueRow).join(''),
        leading ? 'Leading ' + leading + ' of ' + own.length : 'Free to play, always');
    }

    if (imported.length) {
      var covered = (ent().club || {});
      var note = covered.leagueName
        ? 'Club pass on ' + esc(covered.leagueName) + ' runs to ' +
          new Date(covered.activeUntil).toLocaleDateString('en-GB')
        : 'Kept running by a Club pass';
      body += sec('Leagues you brought over', imported.map(leagueRow).join(''), note);
    }

    if (!own.length && !imported.length) {
      body += sec('Your competitions', '<p>You are not in any competitions yet.</p>');
    }

    if (!imported.length) {
      body += sec('Bring your mini-league over',
        '<div class="two"><div>' +
        '<h3>Your lot already have a league. Give it a season.</h3>' +
        '<p>Import your FPL mini-league and everyone in it gets a table, fixtures, promotion, ' +
        'relegation and eight other ways to take the mick \u2014 off one code, with nobody ' +
        're-entering anything.</p>' +
        '<p class="note">Importing happens in the app. Free for the first two gameweeks, then one ' +
        'Club pass keeps it running for the season.</p>' +
        '</div><div>' +
        inset('Club pass', 'One payment, the whole league',
          'Bought once by anyone in the league, not per person. Priced by how many managers ' +
          'actually joined, so nothing is wasted on people who never turned up.', '', 'gold') +
        '</div></div>');
    }

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
    var opts = [['back', 'Look back'], ['ahead', 'Plan ahead'], ['pack', 'The pack']];
    return '<div class="seg-toggle">' + opts.map(function (o) {
      return '<button type="button" data-mode="' + o[0] + '" class="' +
        (state.mode === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div>';
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
    if (state.mode === 'pack') return viewPack();
    return state.mode === 'ahead' ? viewAnalysisAhead() : viewAnalysisBack();
  }

  /* ── the pack: thirty above you, thirty below ─────────────────────── */

  function packRow(x, kind) {
    var count = kind === 'above' ? x.ownedAbove : kind === 'below' ? x.ownedBelow : x.ownedPack;
    var of = kind === 'above' ? (state.d.pack.window.above || 1)
           : kind === 'below' ? (state.d.pack.window.below || 1)
           : ((state.d.pack.window.above || 0) + (state.d.pack.window.below || 0)) || 1;
    return '<tr><td><span class="nm">' + esc(x.name) + '</span>' +
      '<span class="sub">' + esc(x.pos) + ' &middot; ' + esc(x.team) +
      ' &middot; &pound;' + n(x.price) + 'm</span></td>' +
      '<td class="own r">' + pips(count, of, kind === 'below') +
      '<span class="cnt">' + count + '/' + of + '</span></td>' +
      '<td class="r"><span class="v">' + n(x.xp) + '</span></td></tr>';
  }

  /**
   * A signal. Ownership only appears when it varies across the list — eleven
   * rows repeating the same fraction is texture, not information, so when it
   * is constant it is said once in words instead.
   */
  function signal(title, why, rows, kind) {
    if (!rows || !rows.length) {
      return '<div class="sig"><h4>' + esc(title) + '</h4><div class="why">' + esc(why) + '</div>' +
        '<p class="tiny">Nothing here this week.</p></div>';
    }
    var w = state.d.pack.window;
    var of = kind === 'below' ? (w.below || 1) : kind === 'above' ? (w.above || 1)
           : ((w.above || 0) + (w.below || 0)) || 1;
    var count = function (x) {
      return kind === 'below' ? x.ownedBelow : kind === 'above' ? x.ownedAbove : x.ownedPack;
    };
    var rule = ownRule(rows.map(count), of);

    return '<div class="sig"><h4>' + esc(title) + '</h4><div class="why">' + esc(why) + '</div>' +
      (rule.said ? '<p class="tiny" style="margin-bottom:8px">' + esc(rule.said) + '</p>' : '') +
      shortlist(rows, function (x) { return x.xp; },
        'Forecast points, drawn against the best on this list',
        function (x) {
          var c = count(x);
          var show = rule.perRow || c !== rule.modal;
          return esc(x.pos) + ' \u00B7 ' + esc(x.team) + (show ? ' \u00B7 ' + c + ' of ' + of : '');
        },
        kind === 'below' ? 'warn' : '') + '</div>';
  }

  function viewPack() {
    var p = state.d.pack;
    var band = bandTop('Analysis', 'The pack',
      'The thirty managers above you on Clashd and the thirty below, and what they own that you do not.', true) + toggle();

    if (!p) {
      return { band: band, body: sell() + sec('The pack',
        '<p>This needs Clashd Analysis. Subscribe in the app and it appears here.</p>'), title: 'Analysis' };
    }
    if (p.ready === false) {
      return { band: band, body: sell() + sec('The pack', '<p>' + esc(p.reason || '') + '</p>'), title: 'Analysis' };
    }

    var above = p.window.above || 0, below = p.window.below || 0, pack = above + below;
    var thin = pack < 20;
    var body = sell();

    /* The headline. Held back while the sample is thin: a bold claim off five
       squads reads as authority the data has not earned. */
    if (p.headline && !thin) {
      body += sec('What would separate you',
        '<div class="headline"><div class="big">' + esc(p.headline.message) + '</div></div>',
        'Gameweek ' + n(p.gameweek));
    } else if (p.headline) {
      body += sec('What would separate you',
        '<div class="headline"><div class="big">' + esc(p.headline.player) +
        ' is the widest margin open to you.</div>' +
        '<div class="sub">Measured against ' + above + ' manager' + (above === 1 ? '' : 's') +
        ' above you and ' + below + ' below. That is a small pack, so read this as a pointer rather ' +
        'than a verdict \u2014 it sharpens as Clashd grows.</div></div>',
        'Gameweek ' + n(p.gameweek));
    }

    /* the differential XI */
    var xi = p.xi || {};
    var flat = ['GK', 'DEF', 'MID', 'FWD'].reduce(function (a, k) { return a.concat(xi[k] || []); }, []);
    var xiRule = ownRule(flat.map(function (x) { return x.ownedAbove; }), above || 1);
    var xiTop = Math.max.apply(null, flat.map(function (x) { return x.xp; }).concat([1]));

    var cols = ['GK', 'DEF', 'MID', 'FWD'].map(function (pos) {
      var list = xi[pos] || [];
      return '<div class="col">' + lbl(pos) + (list.length ? list.map(function (x, i) {
        return '<div class="p' + (i === 0 ? ' top' : '') + '">' +
          '<span class="nm">' + esc(x.name) + '</span>' +
          '<span class="meta"><span>' + esc(x.team) + '</span><b>' + n(x.xp) + '</b>' +
          ((xiRule.perRow || x.ownedAbove !== xiRule.modal)
            ? '<span>' + x.ownedAbove + ' of ' + (above || 1) + '</span>' : '') + '</span>' +
          '<div class="track" style="height:4px;background:var(--rule-2);margin-top:5px">' +
          '<i style="display:block;height:4px;width:' +
          Math.max(4, x.xp / xiTop * 100).toFixed(0) + '%;background:' +
          (i === 0 ? 'var(--gold)' : 'var(--green)') + '"></i></div>' +
          '</div>';
      }).join('') : '<p class="tiny">Nothing rare enough.</p>') + '</div>';
    }).join('');

    /* The one fact worth stating, stated once rather than on every row. */
    var xiSaid = '';
    if (flat.length && xiRule.said) {
      xiSaid = '<div class="said"><div class="big">' +
        (xiRule.modal === 0
          ? 'None of the ' + above + ' managers above you own any of these.'
          : xiRule.modal + ' of the ' + above + ' above you own each of these.') +
        '</div><div class="sub">Forecast points over the next six gameweeks, drawn against the ' +
        'best available to you. Anyone they do own is marked.</div></div>';
    }

    body += sec('The differential eleven', xiSaid + '<div class="xi">' + cols + '</div>',
      'Rare among those above you, forecast well');

    body += sec('Read in both directions',
      '<div class="three">' +
      signal('Bleeding', 'The pack has him and you do not. Not clever, just costly \u2014 every week he returns you lose ground to almost everyone.', p.bleeding, 'pack') +
      signal('Exposure', 'Common among those below you, not yours. This is how you get overtaken.', p.exposure, 'below') +
      signal('Your edge', 'Already yours, and rare in the pack. You are ahead on these \u2014 hold or bank.', p.edge, 'pack') +
      '</div>',
      above + ' above &middot; ' + below + ' below');

    return { band: band, body: body, title: 'Analysis' };
  }

  /* ── news ─────────────────────────────────────────────────────────── */

  function viewNews() {
    var d = state.d.news || {};
    var items = d.items || [];
    var band = bandTop('Newsroom', 'What changed',
      'Clashd announcements and the Premier League fitness news that moves your squad.', true);

    if (!items.length) {
      return { band: band, body: sec('Newsroom', '<p>Nothing published yet.</p>'), title: 'News' };
    }

    var clashd = items.filter(function (x) { return x.kind === 'CLASHD'; });
    var fpl = items.filter(function (x) { return x.kind === 'FPL'; });

    var lead = clashd[0];
    var left = '';
    if (lead) {
      left += '<div class="lede-item"><div class="kick">' +
        '<span class="tag-chip good">' + esc(lead.category || 'Clashd') + '</span>' +
        (lead.pinned ? '<span class="tag-chip gain">Pinned</span>' : '') + '</div>' +
        '<h3>' + esc(lead.title) + '</h3>' +
        (lead.body ? '<p>' + esc(lead.body) + '</p>' : '') + '</div>';
    }
    left += '<div class="feed">' + clashd.slice(1).map(function (x) {
      return '<div class="item"><div class="bar clashd"></div><div>' +
        '<div class="t">' + esc(x.title) + '</div>' +
        (x.body ? '<div class="b">' + esc(x.body) + '</div>' : '') +
        (x.createdAt ? '<div class="w">' + new Date(x.createdAt).toLocaleDateString('en-GB') + '</div>' : '') +
        '</div></div>';
    }).join('') + '</div>';
    if (!clashd.length) left = '<p class="tiny">No Clashd posts yet.</p>';

    /* Fitness news, ordered by how much it hurts: a ruled-out player first. */
    var right = '<div class="feed">' + fpl.slice(0, 18).map(function (x) {
      var c = has(x.chance) ? Number(x.chance) : null;
      var bar = c === 0 ? 'out' : (c !== null && c < 100 ? 'doubt' : '');
      var tag = c === 0 ? 'Out' : c !== null && c < 100 ? c + '% chance' : '';
      return '<div class="item"><div class="bar ' + bar + '"></div><div>' +
        '<div class="t">' + esc(x.title) + '</div>' +
        (x.body ? '<div class="b">' + esc(x.body) + '</div>' : '') +
        (tag ? '<div class="w">' + esc(tag) + '</div>' : '') +
        '</div></div>';
    }).join('') + '</div>';

    var body = sec('From Clashd', '<div class="news"><div>' + left + '</div>' +
      '<div>' + lbl('Fitness and availability') +
      (d.fplAvailable === false ? '<p class="tiny">The Premier League feed is unavailable right now.</p>' : right) +
      '</div></div>');

    return { band: band, body: body, title: 'News' };
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
    else if (state.view === 'news') v = viewNews();
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
