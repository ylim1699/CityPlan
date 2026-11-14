/* Rexburg Growth Atlas: interface + 3D view. Reads everything from window.ATLAS (model.js). */
(function () {
  'use strict';
  var A = window.ATLAS;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function tOf(i) { return 2024 + i / 4 + 0.125; }
  function qLabel(t) { var y = Math.floor(t); return 'Q' + (Math.floor((t - y) * 4) + 1) + ' ' + y; }
  function hourLabel(h) { return h === 0 ? 'midnight' : h === 12 ? 'noon' : (h % 12) + (h < 12 ? ' am' : ' pm'); }
  function daylight(h) { function ss(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); } return ss(5.5, 7.5, h) * (1 - ss(17.5, 20, h)); }
  var CCOL = ['#86b9a5', '#d6c75a', '#e29a3c', '#d0532e', '#8c1c2b'];
  var TODAY_I = 11;
  var FIXES = [
    { k: 'turn', l: 'Turn lanes (+15%)', f: 1.15 },
    { k: 'signal', l: 'Signal timing (+8%)', f: 1.08 },
    { k: 'round', l: 'Roundabout (+25%)', f: 1.25 }
  ];
  var state = {
    mode: 'resident', hour: 17, widen: [], withProjects: true, ti: TODAY_I, sel: null, spring: false, fixes: [],
    prm: { enroll: A.DEFAULTS.enroll, stay: A.DEFAULTS.stay, bedsPerYear: A.DEFAULTS.bedsPerYear, unitsPerYear: A.DEFAULTS.unitsPerYear, carShare: A.DEFAULTS.carShare },
    layers: { traffic: true, cars: true, proj: true, walk: true }
  };
  var panelKey = '', view = null, cur = null;

  function compute() {
    var t = tOf(state.ti), pop = A.popSeries(state.prm);
    var o = { pop: pop, spring: state.spring, fixes: state.fixes };
    var w = A.traffic(t, state.hour, { pop: pop, spring: state.spring, fixes: state.fixes, widen: state.widen, withProjects: true });
    var b = A.traffic(t, state.hour, { pop: pop, spring: state.spring, fixes: state.fixes, widen: state.widen, withProjects: false });
    return { t: t, tp: state.withProjects ? t : Math.min(t, A.TODAY), pop: pop, o: o, withP: w, base: b, shown: state.withProjects ? w : b };
  }
  function pStatus(p, tp) {
    var s = A.projState(p, tp);
    if (s.phase === 'done') return { key: 'done', label: 'Finished', progress: 1 };
    if (s.phase === 'active') return { key: 'construction', label: p.unconfirmed ? 'Under way, timing assumed' : 'Under construction', progress: s.progress };
    return { key: p.status === 'planned' ? 'planned' : 'approved', label: p.status === 'planned' ? 'Planned' : 'Approved, not started', progress: 0 };
  }
  function when(p, st) {
    if (st.key === 'done') return 'Finished ' + qLabel(p.end);
    if (st.key === 'construction') return 'Target ' + qLabel(p.end);
    return 'Starts ' + qLabel(p.start);
  }

  /* ---------------- Panels ---------------- */
  function hotHtml(c, n, plain) {
    var hs = A.hotspots(c.shown, c.base, n);
    return hs.map(function (h) {
      var lv = A.level(h.vc), d = state.withProjects ? h.delta : 0;
      var extra = d > 0.015 ? ' · projects add ' + Math.round(d * 100) + ' points' : '';
      return '<div class="hot"><span class="stripe" style="background:' + CCOL[lv.key] + '"></span><div><b>' + esc(h.seg.road.name) +
        '</b><small>near ' + esc(h.seg.near) + ' · ' + (plain ? 'about ' : '') + pct(h.vc) + ' of capacity' + extra + '</small></div>' +
        '<span class="lv" style="background:' + CCOL[lv.key] + (lv.key === 1 ? ';color:#3a3410' : '') + '">' + lv.label + '</span></div>';
    }).join('');
  }
  function projCard(p, c) {
    var st = pStatus(p, c.tp);
    return '<button class="proj" data-proj="' + p.id + '"><div class="row"><span class="pill" data-s="' + st.key + '">' + st.label +
      '</span><small class="num">' + when(p, st) + '</small></div><h3>' + esc(p.name) + '</h3><p>' + esc(p.plain) + '</p>' +
      (st.key === 'construction' ? '<div class="bar"><i style="width:' + Math.round(st.progress * 100) + '%"></i></div>' : '') + '</button>';
  }
  function renderResident(c, body) {
    var order = { construction: 0, approved: 1, planned: 2, done: 3 };
    var list = A.PROJECTS.map(function (p) { return { p: p, st: pStatus(p, c.tp) }; })
      .sort(function (a, b) { return order[a.st.key] - order[b.st.key] || a.p.end - b.p.end; });
    var nA = list.filter(function (x) { return x.st.key === 'construction'; }).length;
    var nF = list.filter(function (x) { return x.st.key === 'approved' || x.st.key === 'planned'; }).length;
    var nD = list.length - nA - nF;
    var gp = A.gaps(c.t, state.prm, c.pop).parking, parkHtml = '';
    if (gp) {
      var plv = gp.ratio >= 1 ? 0 : 3;
      parkHtml = '<div><p class="sec">Parking near campus</p><div class="hot"><span class="stripe" style="background:' + CCOL[plv] + '"></span><div><b>' +
        (gp.ratio >= 1 ? 'Probably enough spaces' : 'Probably fewer spaces than student cars') + '</b><small>No official count is published. Mapped lots in the walk district hold very roughly ' +
        fmt(gp.supply) + ' spaces for about ' + fmt(gp.need) + ' student cars, and many of those lots are church or business lots.</small></div>' +
        '<span class="lv" style="background:' + CCOL[plv] + '">Rough</span></div></div>';
    }
    $('r-title').textContent = 'What is changing in Rexburg';
    $('r-sub').textContent = qLabel(c.t) + ': ' + nA + ' under way, ' + nF + ' not started, ' + nD + ' finished since 2024.';
    body.innerHTML =
      '<div><p class="sec">Where it gets slow · ' + hourLabel(state.hour) + '</p><div>' + hotHtml(c, 3, true) + '</div></div>' +
      parkHtml +
      '<div><p class="sec">Projects · tap one to find it</p><div class="list">' + list.map(function (x) { return projCard(x.p, c); }).join('') + '</div></div>' +
      '<p class="note">Road colors come from a model, not from traffic counters. Use them to compare streets, not as exact delays. Building progress is estimated from published dates.</p>';
  }
  function spark(fn, c) {
    var ys = [], y, lo = 0.88, hi = 1.06;
    for (y = 2026; y <= 2034; y++) { var v = fn(y + 0.875); ys.push(v); lo = Math.min(lo, v - 0.02); hi = Math.max(hi, v + 0.02); }
    function X(i) { return 4 + i * (192 / 8); } function Y(v) { return 30 - (v - lo) / (hi - lo) * 26; }
    var pts = ys.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ');
    var ci = c.t - 2026.875, dot = '';
    if (ci >= 0 && ci <= 8) dot = '<circle cx="' + X(ci).toFixed(1) + '" cy="' + Y(fn(c.t)).toFixed(1) + '" r="3.2" fill="#1c2a2d"/>';
    return '<svg class="spark" viewBox="0 0 200 34" preserveAspectRatio="none" role="img" aria-label="Trend from 2026 to 2034">' +
      '<line x1="4" x2="196" y1="' + Y(1).toFixed(1) + '" y2="' + Y(1).toFixed(1) + '" stroke="#9aa8a3" stroke-dasharray="3 3" stroke-width="1"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="#0d6767" stroke-width="2" vector-effect="non-scaling-stroke"/>' + dot + '</svg>';
  }
  function gapRow(title, g, unit, fn, c) {
    var col = g.ratio >= 1 ? '#0e8a79' : (g.ratio >= 0.95 ? '#e29a3c' : '#d0532e');
    return '<div class="gap"><div class="row"><b>' + title + '</b><span class="big">' + pct(g.ratio) + '</span></div>' +
      '<div class="meter"><i style="width:' + (Math.min(g.ratio, 1.2) / 1.2 * 100).toFixed(1) + '%;background:' + col + '"></i><u style="left:83.3%"></u></div>' +
      '<small>' + fmt(g.supply) + ' ' + unit + ' for a need of ' + fmt(g.need) + (g.short > 0 ? ' · short by ' + fmt(g.short) : ' · covered') + '</small>' + spark(fn, c) + '</div>';
  }
  function sliderHtml(id, label, min, max, step, val, show, note) {
    return '<div class="slider"><label for="' + id + '"><span>' + label + '</span><span class="num" id="' + id + '-v">' + show(val) + '</span></label>' +
      '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '">' + (note ? '<small>' + note + '</small>' : '') + '</div>';
  }
  function plannerSkeleton(body) {
    $('r-title').textContent = 'Planner view';
    body.innerHTML = '<div id="pl-pop"></div><div><p class="sec">Supply against need</p><div id="pl-gaps"></div></div>' +
      '<div><p class="sec">Assumptions you can change</p>' +
      sliderHtml('a-enroll', 'Enrollment growth per year', -2, 6, 0.5, state.prm.enroll * 100, function (v) { return (v > 0 ? '+' : '') + (+v).toFixed(1) + '%'; }, 'Fall 2025 grew 6.7%. Fall 2026 fell 1.4%.') +
      sliderHtml('a-stay', 'Leaving students who stay in town', 0, 20, 1, state.prm.stay * 100, function (v) { return Math.round(v) + '%'; }, 'No local figure found. Treat as low, medium, high.') +
      sliderHtml('a-beds', 'New student beds per year', 0, 800, 50, state.prm.bedsPerYear, function (v) { return fmt(v); }, 'Set to 0 for "housing supply stays fixed". Beds cap enrollment.') +
      (A.CITY.collegeTown ? sliderHtml('a-cars', 'Students who bring a car', 20, 90, 5, state.prm.carShare * 100, function (v) { return Math.round(v) + '%'; }, 'Assumed. Spaces are estimated from ' + A.CITY.parkLots + ' mapped lots in the walk district, including church and business lots.') : '') +
      sliderHtml('a-units', 'New homes per year beyond known projects', 0, 400, 20, state.prm.unitsPerYear, function (v) { return fmt(v); }, '') +
      '<label class="check"><input type="checkbox" id="a-spring"' + (state.spring ? ' checked' : '') + '>Spring semester (about 72% of fall students)</label></div>' +
      '<div><p class="sec">Pressure points · <span id="pl-per"></span></p><div class="tablewrap" id="pl-hot"></div><div id="pl-fix"></div></div>' +
      '<div><p class="sec">Developer-led widenings the city lists with no date</p><div id="pl-wid"></div></div>' +
      '<div><p class="sec">Project register</p><div class="tablewrap" id="pl-reg"></div><div id="pl-un"></div></div>';
    function bind(id, key, scale, show) {
      $(id).addEventListener('input', function (e) {
        state.prm[key] = +e.target.value * scale; $(id + '-v').textContent = show(+e.target.value); update();
      });
    }
    bind('a-enroll', 'enroll', 0.01, function (v) { return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; });
    bind('a-stay', 'stay', 0.01, function (v) { return Math.round(v) + '%'; });
    bind('a-beds', 'bedsPerYear', 1, fmt);
    bind('a-units', 'unitsPerYear', 1, fmt);
    if (A.CITY.collegeTown) bind('a-cars', 'carShare', 0.01, function (v) { return Math.round(v) + '%'; });
    $('a-spring').addEventListener('change', function (e) { state.spring = e.target.checked; update(); });
  }
  function renderPlanner(c) {
    var g = A.gaps(c.t, state.prm, c.pop), over = A.roadShareOver(c.shown, 0.85);
    $('r-sub').textContent = qLabel(c.t) + ' · ' + (state.withProjects ? 'growth plus planned projects' : 'growth only, no new projects');
    $('pl-pop').innerHTML = '<p class="sec">Population in the model</p><div class="row"><div><div class="num" style="font-size:18px">' + fmt(g.pop.S) +
      '</div><small style="color:var(--muted)">students in town</small></div><div><div class="num" style="font-size:18px">' + fmt(g.pop.R) +
      '</div><small style="color:var(--muted)">other residents</small></div><div><div class="num" style="font-size:18px">' + fmt(g.pop.total) +
      '</div><small style="color:var(--muted)">total</small></div></div>';
    var capNote = c.pop.capYear ? '<p class="note warn">With these settings, student beds run out and cap enrollment from fall ' + c.pop.capYear + '. Growth past that point depends on new beds, not demand.</p>'
      : '<p class="note">With these settings, beds keep pace with enrollment through 2035.</p>';
    $('pl-gaps').innerHTML =
      gapRow('Student beds', g.beds, 'beds', function (t) { return A.gaps(t, state.prm, c.pop).beds.ratio; }, c) +
      gapRow('Homes for residents', g.homes, 'homes', function (t) { return A.gaps(t, state.prm, c.pop).homes.ratio; }, c) +
      (g.parking ? gapRow('Campus-area parking <span class="conf" data-c="low">rough</span>', g.parking, 'spaces', function (t) { return A.gaps(t, state.prm, c.pop).parking.ratio; }, c) +
        '<div class="note" style="margin:-2px 0 6px">Three parking numbers, kept apart: <b>official</b> per-lot counts from BYU-Idaho Parking Services (not published; ask Parking Services), <b>counted</b> stalls from aerial photos (none yet), and the <b>rough</b> lot-area estimate above. New housing shows its code-minimum parking in each project\'s details.</div>' : '') +
      '<div class="gap"><div class="row"><b>Main streets at 85% of capacity or more</b><span class="big">' + pct(over) + '</span></div><small>Share of modeled street length, ' +
      hourLabel(state.hour) + '</small></div>' + capNote;
    $('pl-per').textContent = hourLabel(state.hour);
    var hs = A.hotspots(c.shown, c.base, 5);
    $('pl-hot').innerHTML = '<table><thead><tr><th>Street</th><th>Load</th><th>Basis</th><th>Test a fix</th></tr></thead><tbody>' + hs.map(function (h, i) {
      var lv = A.level(h.vc), d = state.withProjects ? h.delta : 0;
      return '<tr><td><b>' + esc(h.seg.road.name) + '</b><br><small style="color:var(--muted)">near ' + esc(h.seg.near) + '</small></td><td><span class="num">' + pct(h.vc) +
        '</span><br><small style="color:' + CCOL[Math.max(lv.key, 2)] + ';font-weight:600">' + lv.label + '</small>' + (d > 0.004 ? '<br><small>projects +' + Math.round(d * 100) + ' pts</small>' : '') + '</td><td><small title="' + esc(h.seg.adtBasis) + '">' +
        (h.seg.counted ? 'City count ' + (h.seg.adtBasis.match(/\d{4}/) || [''])[0] : 'Assumed traffic') + '<br>' + h.seg.road.lanes + (h.seg.road.oneway ? ' lanes one way' : ' lanes') + '</small>' +
        '</td><td><select id="fix-' + i + '" data-road="' + esc(h.seg.road.name) + '" data-x="' + h.seg.mid[0] + '" data-z="' + h.seg.mid[1] + '" data-name="' + esc(h.seg.road.name + ' near ' + h.seg.near) +
        '" aria-label="Test a fix on ' + esc(h.seg.road.name) + '"><option value="">Choose</option>' + FIXES.map(function (f) { return '<option value="' + f.k + '">' + f.l + '</option>'; }).join('') + '</select></td></tr>';
    }).join('') + '</tbody></table>';
    $('pl-fix').innerHTML = (state.fixes.length ? '<p style="margin:8px 0 4px;display:flex;flex-wrap:wrap;gap:6px">' + state.fixes.map(function (f, i) {
      return '<span class="fixchip">' + esc(f.label) + '<button data-unfix="' + i + '" aria-label="Remove test">×</button></span>';
    }).join('') + '</p>' : '') + '<p class="note">Fixes are preset capacity changes, so results are relative. Cost, land, utilities and safety standards are outside the model.</p>';
    var w0 = c.shown;
    $('pl-wid').innerHTML = '<p class="note" style="margin:0 0 6px">Tick one to assume it is built (+80% capacity on those streets) and see the effect at ' + hourLabel(state.hour) + ', ' + qLabel(c.t) + '.</p>' +
      A.WIDEN.filter(function (w) { return w.segs.length; }).map(function (w) {
        var on = state.widen.indexOf(w.id) >= 0, mx = 0;
        w.segs.forEach(function (i) { mx = Math.max(mx, w0[i].vc); });
        return '<label class="check" style="align-items:flex-start"><input type="checkbox" data-widen="' + w.id + '"' + (on ? ' checked' : '') + '><span>' + esc(w.name) +
          '<br><small style="color:var(--muted)">' + esc(w.desc || '') + ' · busiest part now at ' + pct(mx) + ' of capacity</small></span></label>';
      }).join('') + '<p style="margin:4px 0 0;font-size:12px"><a href="' + A.WIDEN_SRC.url + '" target="_blank" rel="noopener">' + esc(A.WIDEN_SRC.label) + '</a></p>';
    $('pl-reg').innerHTML = '<table><thead><tr><th>Project</th><th>Status</th><th>Confidence</th><th>Source</th></tr></thead><tbody>' + A.PROJECTS.map(function (p) {
      var st = pStatus(p, c.tp);
      return '<tr><td><button class="back" data-proj="' + p.id + '">' + esc(p.name) + '</button><br><small style="color:var(--muted)">' + esc(p.type) + '</small></td><td><span class="pill" data-s="' + st.key + '">' +
        (st.key === 'construction' ? Math.round(st.progress * 100) + '%' : st.label.split(',')[0]) + '</span></td><td><span class="conf" data-c="' + p.confidence + '">' + p.confidence + '</span></td><td><a href="' + p.source.url + '" target="_blank" rel="noopener">' + esc(p.source.label) + '</a></td></tr>';
    }).join('') + '</tbody></table>';
    $('pl-un').innerHTML = A.UNMAPPED.map(function (u) {
      return '<p class="note warn" style="margin:8px 0 0"><b>Not mapped: ' + esc(u.name) + '.</b> ' + esc(u.note) + ' <a href="' + u.source.url + '" target="_blank" rel="noopener">' + esc(u.source.label) + '</a></p>';
    }).join('');
  }
  function renderDetail(c, body) {
    var p = A.byId(state.sel), st = pStatus(p, c.tp);
    $('r-title').textContent = p.name;
    $('r-sub').textContent = p.where;
    body.innerHTML = '<button class="back" id="d-back">← All projects</button>' +
      '<div class="row"><span class="pill" data-s="' + st.key + '">' + st.label + '</span><span class="conf" data-c="' + p.confidence + '">' + p.confidence + ' confidence</span></div>' +
      (st.key === 'construction' ? '<div><div class="bar"><i style="width:' + Math.round(st.progress * 100) + '%"></i></div><small style="color:var(--muted)">About ' +
        Math.round(st.progress * 100) + '% of the way from start to target date at ' + qLabel(c.tp) + '. Estimated from dates, not from the site.</small></div>' : '') +
      '<p style="margin:0">' + esc(p.plain) + '</p>' +
      '<dl><dt>Type</dt><dd>' + esc(p.type) + '</dd><dt>Size</dt><dd>' + esc(p.size) + '</dd><dt>Timing</dt><dd class="num">' + qLabel(p.start) + ' to ' + qLabel(p.end) +
      '</dd>' + (p.units ? '<dt>Parking</dt><dd><span class="num">' + fmt(p.parkRate ? p.units * p.parkRate : p.units * A.CITY.codeRate.perUnit * (1 + A.CITY.codeRate.visitor)) + '</span> spaces required by city code (' +
        (p.parkRate ? 'elderly housing rate, 1 per unit' : '2 per unit plus 10% for visitors, if treated as multi-family') + '). Code minimum, not observed supply.</dd>' : '') +
      '<dt>Traffic</dt><dd>' + (p.trips ? '<span class="num">' + fmt(p.trips) + '</span> car trips a day when complete. ' : '') + esc(p.tripBasis) + '</dd></dl>' +
      '<div><p class="sec">From the source</p><p style="margin:0 0 6px">' + esc(p.evidence) + '</p><a href="' + p.source.url + '" target="_blank" rel="noopener">' + esc(p.source.label) + '</a></div>' +
      (p.flags.length ? '<div><p class="sec">Check before relying on this</p><ul class="flags">' + p.flags.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div>' : '');
    $('d-back').addEventListener('click', function () { select(null); });
  }
  function renderPanel(c) {
    var body = $('r-body'), key = state.sel ? 'd:' + state.sel : state.mode;
    if (state.sel) { renderDetail(c, body); if (panelKey !== key) body.scrollTop = 0; panelKey = key; return; }
    if (state.mode === 'resident') { renderResident(c, body); if (panelKey !== key) body.scrollTop = 0; panelKey = key; return; }
    if (panelKey !== key) { plannerSkeleton(body); body.scrollTop = 0; panelKey = key; }
    renderPlanner(c);
  }
  function renderTimeline(c) {
    $('tl-label').textContent = qLabel(c.t) + (state.ti === TODAY_I ? ' · today' : '');
    var g = A.gaps(c.t, state.prm, c.pop);
    $('tl-sub').textContent = state.ti === TODAY_I ? 'Drag to look back or ahead' : (state.ti < TODAY_I ? 'Looking back · today is Q4 2026' : 'Projection · about ' + (g.pop.total / 1000).toFixed(1) + 'k people in the model');
  }
  function update() {
    cur = compute();
    renderPanel(cur);
    renderTimeline(cur);
    renderHours(cur);
    if (view) view.apply(cur);
  }
  function select(id) {
    state.sel = id;
    if (id && !lay.pan) { lay.pan = true; layout(false); }
    update();
    if (id && view) view.flyTo(A.byId(id).pos);
  }

  /* ---------------- 3D view ---------------- */
  function initScene() {
    var T = window.THREE;
    if (!T || !T.OrbitControls) return null;
    var canvas = $('scene'), renderer;
    try { renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true }); } catch (e) { return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    var C = A.OSM, S = A.S, scene = new T.Scene();
    scene.background = new T.Color(0xe6ebe6);
    scene.fog = new T.Fog(0xe6ebe6, 70, 150);
    var camera = new T.PerspectiveCamera(38, 1, 0.05, 400);
    var home = A.M(C.places.campus);
    camera.position.set(home[0] + 5, 26, home[1] / 2 + 24);
    var controls = new T.OrbitControls(camera, canvas);
    controls.target.set(home[0] * 0.5, 0, home[1] * 0.5);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = 1.42; controls.minDistance = 1.5; controls.maxDistance = 90;
    controls.update();
    var hemi = new T.HemisphereLight(0xffffff, 0xb9c4bd, 0.9); scene.add(hemi);
    var sun = new T.DirectionalLight(0xffffff, 0.5); sun.position.set(-12, 30, 14); scene.add(sun);

    var tints = [];
    function reg(mat, hex) { tints.push({ m: mat, c: new T.Color(hex) }); return mat; }
    function flatPts(fl) { var o = [], k; for (k = 0; k < fl.length; k += 2) o.push([fl[k] * S, fl[k + 1] * S]); return o; }
    /* Flat polygons merged into one mesh */
    function polys(list, color, y, opacity) {
      var pos = [];
      list.forEach(function (fl) {
        var pts = flatPts(fl); if (pts.length < 3) return;
        var v2 = pts.map(function (p) { return new T.Vector2(p[0], p[1]); }), tri;
        try { tri = T.ShapeUtils.triangulateShape(v2, []); } catch (e) { return; }
        tri.forEach(function (t) { t.forEach(function (i) { pos.push(pts[i][0], y, pts[i][1]); }); });
      });
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      var m = new T.Mesh(g, reg(new T.MeshBasicMaterial({ color: color, side: T.DoubleSide, transparent: opacity < 1, opacity: opacity, depthWrite: opacity >= 1 }), color));
      scene.add(m); return m;
    }
    /* Ribbons along polylines; optional per-ribbon vertex colors */
    function ribbons(lines, y, withColor) {
      var pos = [], cnt = [];
      lines.forEach(function (ln) {
        var a = ln.a, b = ln.b, w = ln.w / 2, dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1e-6;
        var ux = dx / l, uz = dz / l, nx = -uz * w, nz = ux * w;
        var ax = a[0] - ux * w * 0.8, az = a[1] - uz * w * 0.8, bx = b[0] + ux * w * 0.8, bz = b[1] + uz * w * 0.8;
        pos.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz, ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
      });
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      if (withColor) g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(pos.length), 3));
      return g;
    }
    function polyLines(fl, w) { var p = flatPts(fl), o = [], k; for (k = 0; k < p.length - 1; k++) o.push({ a: p[k], b: p[k + 1], w: w }); return o; }

    var ground = new T.Mesh(new T.PlaneGeometry(200, 200), reg(new T.MeshBasicMaterial({ color: 0xdfe5df }), 0xdfe5df));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
    polys([C.campus], 0xe8e1cf, 0.002, 1);
    polys(C.parks, 0xc3dbbd, 0.004, 1);
    var lotMesh = polys(C.lots, 0xcfd3cf, 0.005, 1);
    polys(C.water, 0xa9cfe0, 0.006, 1);
    var wl = []; C.waterways.forEach(function (w) { wl = wl.concat(polyLines(w.slice(1), Math.max(w[0], 6) * S * 1.4)); });
    scene.add(new T.Mesh(ribbons(wl, 0.007), reg(new T.MeshBasicMaterial({ color: 0xa9cfe0 }), 0xa9cfe0)));
    var rl = []; C.rail.forEach(function (r) { rl = rl.concat(polyLines(r, 5 * S * 1.4)); });
    scene.add(new T.Mesh(ribbons(rl, 0.008), reg(new T.MeshBasicMaterial({ color: 0x8d8478 }), 0x8d8478)));

    var walk = new T.Group(), W4 = C.walk.map(function (v) { return v * S; });
    var pedPts = C.ped ? flatPts(C.ped) : [[W4[0], W4[1]], [W4[2], W4[1]], [W4[2], W4[3]], [W4[0], W4[3]]];
    var pedMesh = polys([C.ped || [C.walk[0], C.walk[1], C.walk[2], C.walk[1], C.walk[2], C.walk[3], C.walk[0], C.walk[3]]], 0x0d6767, 0.012, 0.07);
    scene.remove(pedMesh); walk.add(pedMesh);
    walk.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(pedPts.map(function (p) { return new T.Vector3(p[0], 0.05, p[1]); })), new T.LineBasicMaterial({ color: 0x0d6767 })));
    scene.add(walk);
    /* Developer-led widenings: purple outlines, brighter when assumed built */
    var widLayer = new T.Group(), widMats = {};
    A.WIDEN.forEach(function (w) {
      var mat = new T.LineBasicMaterial({ color: 0x8557c2, transparent: true, opacity: 0.55 }); widMats[w.id] = mat;
      w.rings.forEach(function (r) { widLayer.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(r.map(function (p) { return new T.Vector3(p[0], 0.07, p[1]); })), mat)); });
    });
    scene.add(widLayer);

    /* Streets: one mesh, colored per segment */
    var EXW = 1.5;
    var roadGeo = ribbons(A.SEGS.map(function (s) { return { a: s.a, b: s.b, w: s.road.c.w * S * EXW }; }), 0.03, true);
    var roadMat = new T.MeshBasicMaterial({ vertexColors: true });
    scene.add(new T.Mesh(roadGeo, roadMat));
    var roadCol = roadGeo.getAttribute('color');

    /* Existing buildings from OpenStreetMap: walls and roofs merged into one mesh */
    var BCOL = [0xf4f5f1, 0xefe6d6, 0xe9dcc4, 0xe2e7ea, 0xf1ece4, 0xe6e8e4, 0xdde2e4].map(function (h) { return new T.Color(h); });
    var bp = [], bc = [];
    C.buildings.forEach(function (b) {
      var t = b[0], h = b[1] * A.VEX * S, pts = flatPts(b.slice(2)), n = pts.length, col = BCOL[t] || BCOL[0], k, tri;
      function push(x, y, z) { bp.push(x, y, z); bc.push(col.r, col.g, col.b); }
      for (k = 0; k < n; k++) {
        var p = pts[k], q = pts[(k + 1) % n];
        push(p[0], 0, p[1]); push(q[0], 0, q[1]); push(q[0], h, q[1]);
        push(p[0], 0, p[1]); push(q[0], h, q[1]); push(p[0], h, p[1]);
      }
      try { tri = T.ShapeUtils.triangulateShape(pts.map(function (p) { return new T.Vector2(p[0], p[1]); }), []); } catch (e) { tri = []; }
      tri.forEach(function (tr) { tr.forEach(function (i) { push(pts[i][0], h, pts[i][1]); }); });
    });
    var bGeo = new T.BufferGeometry();
    bGeo.setAttribute('position', new T.Float32BufferAttribute(bp, 3));
    bGeo.setAttribute('color', new T.Float32BufferAttribute(bc, 3));
    bGeo.computeVertexNormals();
    var bMat = reg(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }), 0xffffff);
    scene.add(new T.Mesh(bGeo, bMat));

    /* Projects */
    var up = new T.BoxGeometry(1, 1, 1); up.translate(0, 0.5, 0);
    var upEdges = new T.EdgesGeometry(up);
    var projLayer = new T.Group(); scene.add(projLayer);
    var P3 = {};
    A.PROJECTS.forEach(function (p) {
      var o = { subs: [], strips: [] };
      if (p.foot) {
        var fw = p.foot[0], fd = p.foot[1], n = p.n || 1, cols = Math.ceil(Math.sqrt(n * fw / fd)), rows = Math.ceil(n / cols), cw = fw / cols, cd = fd / rows, k;
        var pad = new T.Mesh(new T.PlaneGeometry(fw + 0.06, fd + 0.06), reg(new T.MeshBasicMaterial({ color: 0xd9d2c0, transparent: true, opacity: 0.8, depthWrite: false }), 0xd9d2c0));
        pad.rotation.x = -Math.PI / 2; pad.position.set(p.pos[0], 0.011, p.pos[1]); projLayer.add(pad);
        for (k = 0; k < n; k++) {
          var x = p.pos[0] - fw / 2 + (k % cols + 0.5) * cw, z = p.pos[1] - fd / 2 + (Math.floor(k / cols) + 0.5) * cd;
          var solid = new T.Mesh(up, new T.MeshLambertMaterial({ color: 0xd4861c }));
          solid.position.set(x, 0, z); solid.scale.set(cw * 0.75, p.h, cd * 0.75);
          var edge = new T.LineSegments(upEdges, new T.LineBasicMaterial({ color: 0x2e6bc9 }));
          edge.position.set(x, 0, z); edge.scale.set(cw * 0.75, p.h, cd * 0.75);
          projLayer.add(solid); projLayer.add(edge);
          o.subs.push({ solid: solid, edge: edge });
        }
      }
      (p.strips || []).forEach(function (ln) {
        var ls = []; for (var j = 0; j < ln.length - 1; j++) ls.push({ a: ln[j], b: ln[j + 1], w: 0.09 });
        var m = new T.Mesh(ribbons(ls, 0.05), new T.MeshBasicMaterial({ color: 0xd4861c })); projLayer.add(m); o.strips.push(m);
      });
      P3[p.id] = o;
    });

    /* Moving traffic */
    var N = 700, carPos = new Float32Array(N * 3), cars = [], carGeo = new T.BufferGeometry();
    carGeo.setAttribute('position', new T.BufferAttribute(carPos, 3));
    var carPts = new T.Points(carGeo, new T.PointsMaterial({ color: 0x22343a, size: 0.07, sizeAttenuation: true }));
    scene.add(carPts);
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var lastRes = null, seed = 11;
    function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    function allocate(res) {
      var cum = [], tot = 0;
      res.forEach(function (r, k) { tot += r.vol * A.SEGS[k].len; cum.push(tot); });
      var j = 0;
      for (var k = 0; k < N; k++) {
        var target = (k + 0.5) / N * tot;
        while (j < cum.length - 1 && cum[j] < target) j++;
        var keep = cars[k] && cars[k].u;
        cars[k] = { s: j, u: keep != null ? keep : rnd(), dir: k % 2 ? 1 : -1 };
      }
      lastRes = res; placeCars(0);
    }
    function placeCars(dt) {
      if (!lastRes) return;
      for (var k = 0; k < N; k++) {
        var c = cars[k], s = A.SEGS[c.s], vc = lastRes[c.s].vc;
        var sp = 1.6 * Math.max(0.1, Math.min(1, 1.2 - vc));
        c.u += c.dir * sp * dt / s.len;
        if (c.u > 1) c.u -= Math.floor(c.u); if (c.u < 0) c.u += Math.ceil(-c.u);
        var dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], l = Math.hypot(dx, dz) || 1, off = c.dir * s.road.c.w * S * EXW * 0.22;
        carPos[k * 3] = s.a[0] + dx * c.u + (-dz / l) * off;
        carPos[k * 3 + 1] = 0.06;
        carPos[k * 3 + 2] = s.a[1] + dz * c.u + (dx / l) * off;
      }
      carGeo.attributes.position.needsUpdate = true;
    }

    /* Labels and pins */
    var overlay = $('overlay'), marks = [];
    function streetAt(name, near) {
      var best = null, bd = 1e9;
      A.SEGS.forEach(function (s) { if (s.road.name !== name) return; var d = Math.hypot(s.mid[0] - near[0], s.mid[1] - near[1]); if (d < bd) { bd = d; best = s.mid; } });
      return best;
    }
    var camp = A.M(C.places.campus), wal = A.M(C.places.walmart), por = A.M(C.places.porter), e333 = A.M(C.places.exit333), e332 = A.M(C.places.exit332);
    [['BYU-Idaho', camp, 0.35], ['Downtown', [0.6, -0.5], 0.3], ['Walmart', wal, 0.25], ['Porter Park', por, 0.05], ['Exit 333', e333, 0.1], ['Exit 332', e332, 0.1],
      ['US-20', streetAt('US-20', [-12, 6]), 0.1], ['2nd East', streetAt('North 2nd East', [2, -5]), 0.1], ['Main St', streetAt('West Main Street', [-6, 0]), 0.1],
      ['University Blvd', streetAt('University Boulevard', [-7, 11]), 0.1], ['Walk district', [W4[2] - 0.6, W4[3] + 0.25], 0.05]]
      .forEach(function (l) {
        if (!l[1]) return;
        var el = document.createElement('div'); el.className = 'place'; el.textContent = l[0]; overlay.appendChild(el);
        marks.push({ el: el, v: new T.Vector3(l[1][0], l[2], l[1][1]), walk: /^Walk/.test(l[0]) });
      });
    if (C.places.river) { var rv = document.createElement('div'); rv.className = 'place water'; rv.textContent = 'Teton River'; overlay.appendChild(rv); marks.push({ el: rv, v: new T.Vector3(C.places.river[0] * S, 0.1, C.places.river[1] * S) }); }
    var pins = [];
    A.PROJECTS.forEach(function (p) {
      var el = document.createElement('button'); el.className = 'pin'; el.setAttribute('aria-label', p.name);
      el.innerHTML = '<span>' + esc(p.name) + '</span><i></i>';
      el.addEventListener('click', function () { select(p.id); });
      overlay.appendChild(el);
      pins.push({ el: el, p: p, v: new T.Vector3(p.pos[0], (p.h || 0.02) + 0.1, p.pos[1]), proj: true });
    });
    var vtmp = new T.Vector3(), W = 1, H = 1;
    function place(m) {
      vtmp.copy(m.v).project(camera);
      var hide = vtmp.z > 1 || vtmp.z < -1 || (m.proj && !state.layers.proj) || (m.walk && !state.layers.walk);
      m.el.style.display = hide ? 'none' : '';
      if (hide) return;
      m.el.style.left = ((vtmp.x * 0.5 + 0.5) * W).toFixed(1) + 'px';
      m.el.style.top = ((-vtmp.y * 0.5 + 0.5) * H).toFixed(1) + 'px';
    }
    function resize() {
      var r = $('app').getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
      renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe($('app')); else window.addEventListener('resize', resize);
    resize();

    var fly = null, clock = new T.Clock(), compass = $('compass').firstChild;
    function frame() {
      var dt = Math.min(clock.getDelta(), 0.05);
      if (fly) {
        fly.k = Math.min(1, fly.k + dt / 0.7);
        var e = 1 - Math.pow(1 - fly.k, 3);
        var tx = fly.from.x + (fly.to.x - fly.from.x) * e, tz = fly.from.z + (fly.to.z - fly.from.z) * e;
        var len = fly.len0 + (fly.len1 - fly.len0) * e;
        controls.target.set(tx, 0, tz);
        camera.position.set(tx + fly.dir.x * len, fly.dir.y * len, tz + fly.dir.z * len);
        if (fly.k >= 1) fly = null;
      }
      controls.update();
      if (!reduce && state.layers.cars) placeCars(dt);
      renderer.render(scene, camera);
      marks.forEach(place); pins.forEach(place);
      compass.style.transform = 'rotate(' + controls.getAzimuthalAngle() + 'rad)';
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    controls.addEventListener('start', function () { fly = null; });

    var tmpc = new T.Color(), grey = new T.Color(0xb9c2bd);
    return {
      apply: function (c) {
        var d = daylight(state.hour), dim = 0.24 + 0.76 * d, night = new T.Color(0x16202a), dusk = (state.hour >= 17 && state.hour <= 19) || (state.hour >= 5 && state.hour <= 7) ? 1 - Math.abs(d - 0.5) * 2 : 0;
        scene.background.setHex(0xe6ebe6).lerp(new T.Color(0xf0d9c2), dusk * 0.6).lerp(night, 1 - d);
        scene.fog.color.copy(scene.background);
        hemi.intensity = 0.2 + 0.7 * d; sun.intensity = 0.04 + 0.46 * d;
        tints.forEach(function (t) { t.m.color.copy(t.c).multiplyScalar(dim); });
        carPts.material.color.set(d < 0.5 ? '#ffe7a0' : '#22343a');
        overlay.classList.toggle('night', d < 0.5);
        roadMat.color.setScalar(state.layers.traffic ? 1 : dim);
        var arr = roadCol.array;
        c.shown.forEach(function (r, k) {
          if (state.layers.traffic) tmpc.set(CCOL[A.level(r.vc).key]); else tmpc.copy(grey);
          for (var v = 0; v < 6; v++) { var o = (k * 6 + v) * 3; arr[o] = tmpc.r; arr[o + 1] = tmpc.g; arr[o + 2] = tmpc.b; }
        });
        roadCol.needsUpdate = true;
        A.WIDEN.forEach(function (w) { var on = state.widen.indexOf(w.id) >= 0; widMats[w.id].opacity = on ? 1 : 0.5; widMats[w.id].color.set(on ? '#5b2fa3' : '#8557c2'); });
        widLayer.visible = state.layers.proj;
        projLayer.visible = state.layers.proj; walk.visible = state.layers.walk; carPts.visible = state.layers.cars;
        A.PROJECTS.forEach(function (p) {
          var st = pStatus(p, c.tp), o = P3[p.id], n = o.subs.length;
          o.subs.forEach(function (s, k) {
            var fill = st.key === 'done' ? 1 : Math.max(0, Math.min(1, st.progress * n - k));
            if (st.key === 'construction' && n === 1) fill = Math.max(0.08, st.progress);
            s.solid.visible = fill > 0;
            s.solid.scale.y = Math.max(0.001, fill * p.h);
            s.solid.material.color.set(st.key === 'done' || fill >= 1 && n > 1 ? '#0e8a79' : '#d4861c').multiplyScalar(0.4 + 0.6 * dim);
            s.edge.visible = st.key !== 'done' && fill < 1;
            s.edge.material.color.set(st.key === 'construction' ? '#a8650f' : st.key === 'planned' ? '#8557c2' : '#2e6bc9');
          });
          o.strips.forEach(function (s) { s.visible = st.key === 'construction'; });
        });
        pins.forEach(function (pn) {
          pn.el.setAttribute('data-s', pStatus(pn.p, c.tp).key);
          pn.el.classList.toggle('sel', state.sel === pn.p.id);
        });
        allocate(c.shown);
      },
      flyTo: function (pos) {
        var off = camera.position.clone().sub(controls.target), len = off.length();
        fly = { k: 0, from: controls.target.clone(), to: new T.Vector3(pos[0], 0, pos[1]), dir: off.normalize(), len0: len, len1: Math.min(len, 9) };
      }
    };
  }

  /* ---------------- Wiring ---------------- */
  function press(group, attr, val) {
    Array.prototype.forEach.call(document.querySelectorAll('[' + attr + ']'), function (b) { b.setAttribute('aria-pressed', b.getAttribute(attr) === val ? 'true' : 'false'); });
  }
  function setHour(h) { state.hour = ((h % 24) + 24) % 24; $('hour').value = state.hour; update(); }
  Array.prototype.forEach.call(document.querySelectorAll('[data-hr]'), function (b) {
    b.addEventListener('click', function () { stopDay(); setHour(+b.getAttribute('data-hr')); });
  });
  $('hour').addEventListener('input', function (e) { stopDay(); setHour(+e.target.value); });
  $('hours').addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-h]') : null; if (b) { stopDay(); setHour(+b.getAttribute('data-h')); } });
  var dayTimer = null;
  function stopDay() { if (dayTimer) { clearInterval(dayTimer); dayTimer = null; $('day-play').textContent = 'Play day'; } }
  $('day-play').addEventListener('click', function () {
    if (dayTimer) { stopDay(); return; }
    $('day-play').textContent = 'Pause';
    dayTimer = setInterval(function () { setHour(state.hour + 1); }, 650);
  });
  function renderHours(c) {
    $('hr-label').textContent = hourLabel(state.hour);
    press(0, 'data-hr', String(state.hour));
    var html = '', h;
    for (h = 0; h < 24; h++) {
      var r = A.traffic(c.t, h, { pop: c.pop, spring: state.spring, fixes: state.fixes, widen: state.widen, withProjects: state.withProjects }), mx = 0, sum = 0, len = 0;
      r.forEach(function (x, k) { mx = Math.max(mx, x.vc); sum += x.vc * A.SEGS[k].len; len += A.SEGS[k].len; });
      html += '<button data-h="' + h + '"' + (h === state.hour ? ' class="on"' : '') + ' title="' + hourLabel(h) + ': busiest street at ' + pct(mx) + '" aria-label="' + hourLabel(h) +
        '" style="height:' + Math.max(8, Math.round(sum / len / 0.6 * 100)) + '%;background:' + CCOL[A.level(mx).key] + '"></button>';
    }
    $('hours').innerHTML = html;
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-scn]'), function (b) {
    b.addEventListener('click', function () { state.withProjects = b.getAttribute('data-scn') === 'with'; press(0, 'data-scn', state.withProjects ? 'with' : 'without'); update(); });
  });
  function setMode(m) {
    state.mode = m; state.sel = null;
    $('mode-resident').setAttribute('aria-pressed', m === 'resident'); $('mode-planner').setAttribute('aria-pressed', m === 'planner');
    update();
  }
  $('mode-resident').addEventListener('click', function () { setMode('resident'); });
  $('mode-planner').addEventListener('click', function () { setMode('planner'); });
  [['ly-traffic', 'traffic'], ['ly-cars', 'cars'], ['ly-proj', 'proj'], ['ly-walk', 'walk']].forEach(function (l) {
    $(l[0]).addEventListener('change', function (e) { state.layers[l[1]] = e.target.checked; update(); });
  });
  var lay = { ctl: true, pan: true, left: false };
  try { var sv = JSON.parse(localStorage.getItem('atlas-layout') || 'null'); if (sv) lay = { ctl: !!sv.ctl, pan: !!sv.pan, left: !!sv.left }; else if (window.innerWidth < 1180) lay.ctl = false; } catch (e) { if (window.innerWidth < 1180) lay.ctl = false; }
  function layout(save) {
    var app = $('app');
    app.classList.toggle('ctl-folded', !lay.ctl); app.classList.toggle('pan-folded', !lay.pan); app.classList.toggle('dock-left', lay.left);
    $('ctl-toggle').setAttribute('aria-pressed', lay.ctl); $('pan-toggle').setAttribute('aria-pressed', lay.pan);
    $('pan-dock').textContent = lay.left ? 'Move right →' : '← Move left';
    if (save) { try { localStorage.setItem('atlas-layout', JSON.stringify(lay)); } catch (e) {} }
  }
  $('ctl-toggle').addEventListener('click', function () { lay.ctl = !lay.ctl; layout(true); });
  $('pan-toggle').addEventListener('click', function () { lay.pan = !lay.pan; layout(true); });
  $('pan-fold').addEventListener('click', function () { lay.pan = false; layout(true); });
  $('ctl-fold').addEventListener('click', function () { lay.ctl = false; layout(true); });
  $('pan-dock').addEventListener('click', function () { lay.left = !lay.left; layout(true); });
  layout(false);
  $('r-body').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-proj]') : null;
    if (b) { select(b.getAttribute('data-proj')); return; }
    var u = e.target.closest ? e.target.closest('[data-unfix]') : null;
    if (u) { state.fixes.splice(+u.getAttribute('data-unfix'), 1); update(); }
  });
  $('r-body').addEventListener('change', function (e) {
    var s = e.target;
    if (s.hasAttribute && s.hasAttribute('data-widen')) {
      var id = s.getAttribute('data-widen');
      state.widen = state.widen.filter(function (x) { return x !== id; });
      if (s.checked) state.widen.push(id);
      update(); return;
    }
    if (!s.id || s.id.indexOf('fix-') !== 0 || !s.value) return;
    var f = FIXES.filter(function (x) { return x.k === s.value; })[0], road = s.getAttribute('data-road');
    state.fixes = state.fixes.filter(function (x) { return x.road !== road; });
    state.fixes.push({ road: road, at: [+s.getAttribute('data-x'), +s.getAttribute('data-z')], factor: f.f, label: f.l + ', ' + s.getAttribute('data-name') });
    update();
  });
  $('time').addEventListener('input', function (e) { state.ti = +e.target.value; update(); });
  var timer = null;
  function stop() { if (timer) { clearInterval(timer); timer = null; } $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play through time'); }
  $('play').addEventListener('click', function () {
    if (timer) { stop(); return; }
    if (state.ti >= 43) state.ti = TODAY_I;
    $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Pause');
    timer = setInterval(function () {
      if (state.ti >= 43) { stop(); return; }
      state.ti++; $('time').value = state.ti; update();
    }, 750);
  });
  (function () {
    var t = $('ticks'), y;
    for (y = 2024; y <= 2034; y++) {
      var s = document.createElement('span'); s.textContent = y === 2024 || y % 2 === 0 ? String(y) : '’' + String(y).slice(2);
      s.style.left = ((y - 2024) * 4 / 43 * 100) + '%'; if (y === 2026) s.className = 'now'; t.appendChild(s);
    }
  })();
  (function () {
    var seen = {}, items = [];
    A.PROJECTS.map(function (p) { return p.source; }).concat(A.UNMAPPED.map(function (u) { return u.source; }), A.CONTEXT.map(function (u) { return u.source; }), [
      { label: 'BYU-Idaho fall 2026 enrollment (East Idaho News)', url: 'https://www.eastidahonews.com/?p=881123' },
      { label: 'BYU-Idaho enrollment and demographics', url: 'https://www.byui.edu/about/enrollment-and-demographics' },
      { label: 'BYU-Idaho fall 2025 enrollment', url: 'https://www.byui.edu/newsroom/announcements/byu-idaho-celebrates-largest-incoming-class-for-second-year-in-a-row' },
      { label: 'BYU-Idaho spring 2026 enrollment (East Idaho News)', url: 'https://www.eastidahonews.com/?p=840638' },
      { label: 'Teton River Idaho Temple size (Church News)', url: 'https://www.thechurchnews.com/almanac/temples/teton-river-idaho/' },
      { label: 'OpenStreetMap (streets, buildings, lots), via Overpass Turbo', url: 'https://www.openstreetmap.org/copyright' },
      { label: 'Madison County / Rexburg GIS: traffic counts and Pedestrian Emphasis District', url: 'https://madison.rexburg.org/mrgis/rest/services/Data' },
      A.WIDEN_SRC
    ]).forEach(function (s) { if (!seen[s.url]) { seen[s.url] = 1; items.push('<li><a href="' + s.url + '" target="_blank" rel="noopener">' + esc(s.label) + '</a></li>'); } });
    $('src-list').innerHTML = items.join('');
  })();
  var dlg = $('about');
  $('about-open').addEventListener('click', function () { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); });
  $('about-close').addEventListener('click', function () { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); });

  try { view = initScene(); } catch (e) { view = null; if (window.console) console.error(e); }
  if (!view) $('fallback').style.display = 'grid';
  update();
})();
