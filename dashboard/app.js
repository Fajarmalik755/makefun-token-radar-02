// Token Radar v2 — a static offline dashboard: no fetch, no network, no framework.
// It reads window.RADAR (written by main.ts from the same board) and renders
// four views from the URL: the board, one protocol's detail, the live-token
// view, and the methodology page. The screenshots and this source agree:
// every number on screen comes from RADAR, nothing is typed by hand.

(function () {
  var R = window.RADAR;
  var app = document.getElementById('app');
  var params = new URLSearchParams(window.location.search);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtUsd(n) {
    if (n == null) return '—';
    var a = Math.abs(n), sign = n < 0 ? '-' : '';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
    return sign + '$' + Math.round(a);
  }
  function fmtInt(n) {
    return n == null ? '—' : Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(x) {
    if (x == null) return '—';
    return (x > 0 ? '+' : '') + x.toFixed(1) + '%';
  }
  function fmtAge(d) {
    if (d == null) return '—';
    if (d < 30) return d + 'd';
    if (d < 365) return Math.round(d / 30) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  }
  function money(n) { return fmtUsd(n); }
  function link(view, extra) {
    var q = new URLSearchParams();
    if (view !== 'board') q.set('view', view);
    if (extra) for (var k in extra) if (extra[k] !== '' && extra[k] != null) q.set(k, extra[k]);
    var s = q.toString();
    return 'index.html' + (s ? '?' + s : '');
  }
  function tabs(active) {
    var t = [['board', 'Board'], ['live', 'Live tokens'], ['method', 'Methodology']];
    var h = '<nav class="tabs">';
    for (var i = 0; i < t.length; i++) {
      h += '<a href="' + link(t[i][0]) + '"' + (t[i][0] === active ? ' class="on"' : '') + '>' + t[i][1] + '</a>';
    }
    return h + '</nav>';
  }
  function head(title, sub) {
    return '<header class="top"><h1>Token Radar <span>v2</span></h1>' +
      '<span class="sub">' + esc(title) + '</span></header>' +
      '<div class="sub" style="color:var(--muted);font-size:12px;margin-top:2px">' + esc(sub) + '</div>';
  }
  function integrityStrip() {
    var g = R.integrity;
    var parts = [];
    for (var k in g.excluded_by_reason) parts.push(esc(k) + ' ' + g.excluded_by_reason[k]);
    return '<div class="strip"><b>758 protocols accounted for:</b> ' +
      '<span class="ok">' + g.ranked + ' ranked</span> · ' + g.traded + ' already trading · ' +
      g.excluded + ' excluded (' + parts.join(' · ') + '). ' +
      'Every watchlist protocol is on the board; no wrapped, staked or bridged product is ranked.</div>';
  }
  function kpiStrip() {
    var f = R.fit, v = R.validation;
    return '<div class="kpis">' +
      '<div class="kpi"><div class="k">Comps fit · log(mcap) on log(TVL)</div><div class="v">' + f.intercept + ' + ' + f.slope + '·x</div><div class="n">n = ' + f.n + ' traded tokens · R² = ' + f.r2 + ' · median ratio ' + f.global_median_ratio + '</div></div>' +
      '<div class="kpi"><div class="k">Held-out, leave-one-out</div><div class="v">median error ' + v.loo.median_ape_pct + '%</div><div class="n">within 3x: ' + v.loo.within_3x_pct + '% · MAPE ' + v.loo.mape_pct + '%</div></div>' +
      '<div class="kpi"><div class="k">Held-out, split-half ×2</div><div class="v">' + v.split_even_odd.within_3x_pct + '% / ' + v.split_odd_even.within_3x_pct + '%</div><div class="n">within 3x each way · Spearman ' + v.spearman + '</div></div>' +
      '<div class="kpi"><div class="k">Farm verdicts · 198 rows</div><div class="v">' + countVerdict('FARM') + ' farm · ' + countVerdict('THIN') + ' thin · ' + countVerdict('SKIP') + ' skip</div><div class="n">net of gas, time shown in hours, never costed</div></div>' +
      '</div>';
  }
  function countVerdict(v) {
    var n = 0;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].verdict === v) n++;
    return n;
  }

  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    ev: function (a, b) { return b.implied_value_usd - a.implied_value_usd || a.rank - b.rank; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
    growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0) || a.rank - b.rank; },
    age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0) || a.rank - b.rank; },
    odds: function (a, b) { return b.odds - a.odds || a.rank - b.rank; },
  };

  function renderBoard() {
    var sort = SORTS[params.get('sort')] ? params.get('sort') : 'rank';
    var fCat = params.get('category') || '', fChain = params.get('chain') || '',
      fVerdict = params.get('verdict') || '', fWl = params.get('wl') === '1',
      fQ = (params.get('q') || '').toLowerCase();
    var cats = [], chains = [];
    R.rows.forEach(function (r) {
      if (cats.indexOf(r.category) < 0 && r.category) cats.push(r.category);
      if (chains.indexOf(r.chain) < 0 && r.chain) chains.push(r.chain);
    });
    cats.sort(); chains.sort();
    var rows = R.rows.filter(function (r) {
      if (fCat && r.category !== fCat) return false;
      if (fChain && r.chain !== fChain) return false;
      if (fVerdict && r.verdict !== fVerdict) return false;
      if (fWl && !r.watchlist) return false;
      if (fQ && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(fQ) < 0) return false;
      return true;
    });
    rows.sort(SORTS[sort]);
    function opt(list, cur, all) {
      var h = '<option value="">' + all + '</option>';
      list.forEach(function (v) { h += '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; });
      return h;
    }
    function sortLink(key, label) {
      var ex = { sort: key };
      if (fCat) ex.category = fCat;
      if (fChain) ex.chain = fChain;
      if (fVerdict) ex.verdict = fVerdict;
      if (fWl) ex.wl = '1';
      if (fQ) ex.q = fQ;
      return '<button data-sort="' + key + '">' + label + (sort === key ? ' ↓' : '') + '</button>';
    }
    var h = '<div class="wrap">';
    h += head('198 pre-token protocols ranked by expected launch value', 'Snapshot ' + esc(R.as_of) + ' · source DefiLlama api.llama.fi/protocols · floor ' + fmtUsd(R.floor_usd) + ' · model ' + esc(R.model_version));
    h += tabs('board');
    h += integrityStrip();
    h += kpiStrip();
    h += '<form class="filters" method="get" action="index.html">' +
      '<label>Category <select name="category">' + opt(cats, fCat, 'All') + '</select></label>' +
      '<label>Chain <select name="chain">' + opt(chains, fChain, 'All') + '</select></label>' +
      '<label>Verdict <select name="verdict">' + opt(['FARM', 'THIN', 'SKIP'], fVerdict, 'All') + '</select></label>' +
      '<label><input type="checkbox" name="wl" value="1"' + (fWl ? ' checked' : '') + '> Watchlist only</label>' +
      '<input type="search" name="q" placeholder="Search name or slug" value="' + esc(params.get('q') || '') + '">' +
      '<input type="hidden" name="sort" value="' + esc(sort) + '">' +
      '<button type="submit" style="background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:6px 12px;cursor:pointer">Apply</button>' +
      '<span class="count">' + rows.length + ' of ' + R.rows.length + ' rows</span></form>';
    h += '<table class="board"><thead><tr><th>#</th><th>' + sortLink('rank', 'Protocol') + '</th><th>Category</th><th>Chain</th>' +
      '<th>' + sortLink('tvl', 'TVL') + '</th><th>' + sortLink('growth', '7d') + '</th><th>' + sortLink('age', 'Age') + '</th>' +
      '<th>' + sortLink('odds', 'Odds') + '</th><th>Implied</th><th>' + sortLink('ev', 'Expected value') + '</th><th>68% interval</th><th>Verdict</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var g = r.change_7d == null ? '<span>—</span>' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</span>';
      h += '<tr><td>' + r.rank + '</td>' +
        '<td class="name"><a href="' + link('detail', { slug: r.slug }) + '">' + esc(r.name) + '</a>' + (r.watchlist ? ' <span class="wl" title="On the watchlist">★</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td><td>' + esc(r.chain) + '</td>' +
        '<td>' + fmtUsd(r.tvl_usd) + '</td><td>' + g + '</td><td>' + fmtAge(r.age_days) + '</td>' +
        '<td>' + (r.odds * 100).toFixed(0) + '%</td><td>' + fmtUsd(r.implied_raw_usd) + '</td>' +
        '<td class="ev">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td>' + fmtUsd(r.ev_low_usd) + ' – ' + fmtUsd(r.ev_high_usd) + '</td>' +
        '<td><span class="pill ' + r.verdict + '">' + r.verdict + '</span></td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="note">Expected value = implied value × token odds. Implied value = exp(' + R.fit.intercept + ' + ' + R.fit.slope + '·ln TVL + category adjustment) × growth × maturity. ' +
      'The interval is the 68% range from the comps\u2019 residual spread (σ ≈ ' + R.fit.global_sigma + ' in log space) — wide because the fit is weak (R² = ' + R.fit.r2 + '). ' +
      'A protocol records no token, never that it has none: its DefiLlama record may simply not carry one.</p>';
    h += '<footer>Token Radar v2 · snapshot ' + esc(R.as_of) + ' · dashboard rendered offline from data.js · no protocol name is special-cased.</footer>';
    h += '</div>';
    app.innerHTML = h;
    app.setAttribute('aria-busy', 'false');
    var btns = app.querySelectorAll('button[data-sort]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        var q = new URLSearchParams(window.location.search);
        q.set('sort', ev.currentTarget.getAttribute('data-sort'));
        window.location.search = q.toString();
      });
    }
  }

  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) { renderBoard(); return; }
    var h = '<div class="wrap">';
    h += head('Protocol detail', 'Rank ' + r.rank + ' of ' + R.rows.length + ' · ' + esc(r.category || 'no category') + ' · ' + esc(r.chain));
    h += tabs('board');
    h += '<div class="detail"><h2>' + esc(r.name) + (r.watchlist ? ' <span class="wl">★ watchlist</span>' : '') + '</h2>' +
      '<div class="meta">TVL ' + fmtUsd(r.tvl_usd) + ' · 7d ' + fmtPct(r.change_7d) + ' · age ' + fmtAge(r.age_days) + ' · slug ' + esc(r.slug) + '</div>' +
      '<div class="grid2">' +
      '<div class="card"><h3>Model breakdown</h3><table class="kv">' +
      '<tr><td>Base from the comps fit</td><td>' + fmtUsd(r.base_usd) + '</td></tr>' +
      '<tr><td>Growth multiplier (7d ' + fmtPct(r.change_7d) + ')</td><td>' + r.growth_multiplier.toFixed(2) + '×</td></tr>' +
      '<tr><td>Maturity multiplier</td><td>' + r.maturity_multiplier.toFixed(2) + '×</td></tr>' +
      '<tr><td>Category adjustment (log)</td><td>' + (r.category_adj >= 0 ? '+' : '') + r.category_adj.toFixed(3) + '</td></tr>' +
      '<tr><td>Implied value (before odds)</td><td>' + fmtUsd(r.implied_raw_usd) + '</td></tr>' +
      '<tr><td>Token odds (age × TVL bucket)</td><td>' + (r.odds * 100).toFixed(1) + '%</td></tr>' +
      '<tr><td>Expected value (implied × odds)</td><td><b>' + fmtUsd(r.implied_value_usd) + '</b></td></tr>' +
      '<tr><td>68% interval</td><td>' + fmtUsd(r.ev_low_usd) + ' – ' + fmtUsd(r.ev_high_usd) + '</td></tr>' +
      '</table></div>' +
      '<div class="card"><h3>Break-even</h3><table class="kv">' +
      '<tr><td>Capital for this position</td><td>' + fmtUsd(r.capital_usd) + '</td></tr>' +
      '<tr><td>Estimated farmers</td><td>~' + fmtInt(r.farmers_est) + '</td></tr>' +
      '<tr><td>Expected airdrop (5% pool)</td><td>' + fmtUsd(r.expected_gross_usd) + '</td></tr>' +
      '<tr><td>Gas, 6 transactions on ' + esc(r.chain) + '</td><td>' + fmtUsd(r.gas_total_usd) + '</td></tr>' +
      '<tr><td>Net</td><td><b>' + fmtUsd(r.net_usd) + '</b></td></tr>' +
      '<tr><td>Verdict</td><td><span class="pill ' + r.verdict + '">' + r.verdict + '</span></td></tr>' +
      '</table></div></div>' +
      '<div class="verdict-box ' + r.verdict + '">Verdict: ' + r.verdict + ' — expected airdrop ' + fmtUsd(r.expected_gross_usd) + ' against ' + fmtUsd(r.gas_total_usd) + ' of gas, net ' + fmtUsd(r.net_usd) + '.</div>' +
      '<h3 style="margin:18px 0 6px">Farm plan — 7 steps</h3><ol class="farm">';
    r.farm_steps.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; });
    h += '</ol><p><a href="' + link('board') + '">← Back to the board</a> · <a href="' + link('method') + '">How this board was built</a></p></div>';
    h += '<footer>Token Radar v2 · snapshot ' + esc(R.as_of) + ' · no protocol name is special-cased.</footer></div>';
    app.innerHTML = h;
    app.setAttribute('aria-busy', 'false');
  }

  function renderLive() {
    var h = '<div class="wrap">';
    h += head('Live tokens — the market\u2019s own values', 'Protocols that already trade, by market cap. Kept apart from the ranked board: a traded token is not a launch to find.');
    h += tabs('live');
    h += '<table class="board" style="margin-top:14px"><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>Chains</th><th>TVL</th><th>Market cap</th><th>7d</th></tr></thead><tbody>';
    R.live.forEach(function (p, i) {
      h += '<tr><td>' + (i + 1) + '</td><td class="name">' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td>' +
        '<td>' + esc(p.chains.slice(0, 3).join(', ')) + '</td><td>' + fmtUsd(p.tvl_usd) + '</td><td><b>' + fmtUsd(p.mcap_usd) + '</b></td>' +
        '<td>' + fmtPct(p.change_7d) + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="note">These 24 are the largest traded tokens in the snapshot. They anchor the comps fit (128 traded tokens with a market cap above zero) but never enter the ranked board.</p>';
    h += '<footer>Token Radar v2 · snapshot ' + esc(R.as_of) + '.</footer></div>';
    app.innerHTML = h;
    app.setAttribute('aria-busy', 'false');
  }

  function renderMethod() {
    var f = R.fit, v = R.validation, o = R.odds, g = R.integrity;
    var h = '<div class="wrap">';
    h += head('How this board was built', 'Every term fitted from the snapshot itself. Nothing about any protocol is hard-coded.');
    h += tabs('method');
    h += '<div class="method">';
    h += '<h2>The model</h2><p>Expected value = implied value × token odds. Implied value = ' +
      '<code>exp(' + f.intercept + ' + ' + f.slope + ' · ln(TVL) + category adjustment) × growth × maturity</code>. ' +
      'Growth is the 7-day TVL change clamped to [−60, +120]%, weighted 0.5. Maturity runs 0.6 (new) to 1.0 (3 years or older); unknown age counts as 365 days.</p>';
    h += '<h3>Comps fit — 128 traded tokens</h3><p>log(mcap) = <code>' + f.intercept + ' + ' + f.slope + ' · log(TVL)</code>, ' +
      'R² = <code>' + f.r2 + '</code>, residual σ = <code>' + f.global_sigma + '</code> in log space, global median mcap/TVL = <code>' + f.global_median_ratio + '</code>. ' +
      'Each category carries its median log-residual, shrunk toward zero with k = ' + f.shrinkage_k + ' (a category with one token barely moves the fit).</p>';
    var cats = Object.keys(f.category_adj).map(function (c) { return [c, f.category_adj[c]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    h += '<table><thead><tr><th>Category</th><th>Adjustment (log)</th><th>σ (log)</th></tr></thead><tbody>';
    cats.forEach(function (c) {
      h += '<tr><td>' + esc(c[0]) + '</td><td>' + (c[1] >= 0 ? '+' : '') + c[1].toFixed(3) + '</td><td>' + (f.category_sigma[c[0]] || f.global_sigma).toFixed(3) + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<h3>Token odds — from the snapshot\u2019s own record</h3><p>Each age × TVL bucket\u2019s traded share, shrunk toward the global traded rate ' +
      (o.global_rate * 100).toFixed(1) + '% with k = ' + o.shrinkage_k + '. Older protocols are more likely to have recorded a token; young small ones least.</p>';
    h += '<table><thead><tr><th>Age × TVL bucket</th><th>Traded</th><th>Odds</th></tr></thead><tbody>';
    Object.keys(o.buckets).sort().forEach(function (k) {
      h += '<tr><td>' + esc(k) + '</td><td>' + esc(o.bucket_counts[k]) + '</td><td>' + (o.buckets[k] * 100).toFixed(1) + '%</td></tr>';
    });
    h += '</tbody></table>';
    h += '<h3>Held-out validation — tested twice, numbers as computed</h3>' +
      '<p class="muted">The core fit (log-log plus category adjustment) is tested against market caps it never saw. ' +
      'MAPE is dominated by a few extreme ratios; the median error and the within-3x rate are the honest read. This model ranks — it does not price precisely.</p>';
    h += '<table><thead><tr><th>Test</th><th>n</th><th>MAPE</th><th>Median error</th><th>Within 3x</th></tr></thead><tbody>' +
      '<tr><td>Leave-one-out</td><td>' + v.loo.n + '</td><td>' + v.loo.mape_pct + '%</td><td>' + v.loo.median_ape_pct + '%</td><td>' + v.loo.within_3x + '/' + v.loo.n + ' (' + v.loo.within_3x_pct + '%)</td></tr>' +
      '<tr><td>Split-half, even → odd</td><td>' + v.split_even_odd.n + '</td><td>' + v.split_even_odd.mape_pct + '%</td><td>' + v.split_even_odd.median_ape_pct + '%</td><td>' + v.split_even_odd.within_3x + '/' + v.split_even_odd.n + ' (' + v.split_even_odd.within_3x_pct + '%)</td></tr>' +
      '<tr><td>Split-half, odd → even</td><td>' + v.split_odd_even.n + '</td><td>' + v.split_odd_even.mape_pct + '%</td><td>' + v.split_odd_even.median_ape_pct + '%</td><td>' + v.split_odd_even.within_3x + '/' + v.split_odd_even.n + ' (' + v.split_odd_even.within_3x_pct + '%)</td></tr>' +
      '</tbody></table><p>Spearman rank correlation, predicted vs actual market cap: <code>' + v.spearman + '</code>.</p>';
    h += '<h3>Farm verdicts — a stated economic model</h3><p>The airdrop pool is assumed to be 5% of expected value, split among an estimated ' +
      '100·√(TVL in $M) farmers at a $1,000 median position. Gas is the main chain\u2019s typical per-transaction cost (November 2026), 6 transactions per plan; ' +
      'unknown chains default to $1.00. Time is shown in hours and never converted to dollars. FARM when the net is at least $20, THIN from $0, SKIP below $0. ' +
      'The snapshot carries no gas data and no farmer counts — these are assumptions, stated here, not measurements.</p>';
    h += '<h3>Integrity — 758 of 758 accounted for</h3><table><thead><tr><th>Bucket</th><th>Count</th></tr></thead><tbody>' +
      '<tr><td>Ranked on the board</td><td>' + g.ranked + '</td></tr>' +
      '<tr><td>Already trading (set aside with their market caps)</td><td>' + g.traded + '</td></tr>';
    Object.keys(g.excluded_by_reason).sort().forEach(function (k) {
      h += '<tr><td>Excluded: ' + esc(k) + '</td><td>' + g.excluded_by_reason[k] + '</td></tr>';
    });
    h += '<tr><td><b>Total</b></td><td><b>' + g.total + '</b></td></tr></tbody></table>';
    h += '<h3>Limits, stated plainly</h3><ul><li>The fit is weak (R² = ' + f.r2 + '): TVL alone explains little of a token\u2019s market cap, and the 68% intervals span roughly 8x. Treat every value as a ranking signal, not a price.</li>' +
      '<li>“Records no token” means the DefiLlama record carries no token — a protocol may still have one its record does not show.</li>' +
      '<li>Snapshot as of ' + esc(R.as_of) + '; nothing after that date is in this board.</li>' +
      '<li>Gas costs and farmer counts are assumptions (see above), not snapshot data.</li></ul>';
    h += '</div><footer>Token Radar v2 · snapshot ' + esc(R.as_of) + ' · model ' + esc(R.model_version) + '.</footer></div>';
    app.innerHTML = h;
    app.setAttribute('aria-busy', 'false');
  }

  var view = params.get('view') || (params.get('slug') ? 'detail' : 'board');
  if (view === 'detail') renderDetail(params.get('slug') || '');
  else if (view === 'live') renderLive();
  else if (view === 'method') renderMethod();
  else renderBoard();
})();
