"""Convert an Overpass Turbo GeoJSON export into the atlas city file (window.OSM_CITY).
Usage: python -I scripts/build_city.py data/raw/export.geojson public/data data/raw
       (second argument: a folder for city-rexburg.json, or a .js path for the legacy window.OSM_CITY file;
        coordinates become integer meters from the origin)"""
import json, math, os, sys, collections, re as _re
SRC, OUT = sys.argv[1], sys.argv[2]
EXTRA = sys.argv[3] if len(sys.argv) > 3 else None   # folder with ped.json, trafficcounts.json, projects.json, streetplan.json
LON0, LAT0 = -111.783826, 43.8260632          # Main St x Center St
KX = math.cos(math.radians(LAT0)) * 111320.0; KZ = 110574.0
def P(lon, lat): return [round((lon - LON0) * KX), round(-(lat - LAT0) * KZ)]
def LL(lat, lon): return P(lon, lat)
F = json.load(open(SRC))['features']

def dp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dz = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dz) or 1e-9
    i, dm = 0, -1
    for k in range(1, len(pts)-1):
        p = pts[k]; d = abs(dz*(p[0]-a[0]) - dx*(p[1]-a[1])) / L
        if d > dm: i, dm = k, d
    if dm <= tol: return [a, b]
    return dp(pts[:i+1], tol)[:-1] + dp(pts[i:], tol)
def dpring(r, tol):
    if len(r) < 5: return r
    m = len(r) // 2
    return dp(r[:m+1], tol)[:-1] + dp(r[m:] + [r[0]], tol)[:-1]
def area(r):
    s = 0
    for i in range(len(r)): x1, z1 = r[i]; x2, z2 = r[(i+1) % len(r)]; s += x1*z2 - x2*z1
    return abs(s) / 2
def cen(r): return [sum(p[0] for p in r)/len(r), sum(p[1] for p in r)/len(r)]
def ring(f):
    c = f['geometry']['coordinates'][0]; r = [P(x, y) for x, y in c]
    if len(r) > 1 and r[0] == r[-1]: r = r[:-1]
    return r
def segdist(p, a, b):
    dx, dz = b[0]-a[0], b[1]-a[1]; l2 = dx*dx + dz*dz
    u = 0 if not l2 else max(0, min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dz) / l2))
    return math.hypot(p[0]-(a[0]+u*dx), p[1]-(a[1]+u*dz))
def inside(p, r):
    x, z = p; c = False; j = len(r)-1
    for i in range(len(r)):
        xi, zi = r[i]; xj, zj = r[j]
        if (zi > z) != (zj > z) and x < (xj-xi)*(z-zi)/(zj-zi+1e-12)+xi: c = not c
        j = i
    return c

# ---------- roads ----------
CLS = {'motorway':'highway','trunk':'arterial','primary':'arterial','secondary':'minor','tertiary':'collector',
       'residential':'local','unclassified':'local'}
for k in ['motorway_link','trunk_link','primary_link','secondary_link','tertiary_link']: CLS[k] = 'ramp'
OVERRIDE = {'North 2nd East': [19000, 'broker listings (18,000 to 23,500 a day)'], 'US 20': [21500, 'broker listing'], 'US 20;SH 33': [21500, 'broker listing']}
names, nidx = [], {}
def ni(n):
    if n not in nidx: nidx[n] = len(names); names.append(n)
    return nidx[n]
def segbase_pre(ri): return sum(len(r['pts']) - 1 for r in roads[:ri])
# Junctions: the export has no node ids, so a coordinate shared by two or more streets is an intersection.
# They are kept through simplification so the road graph for routing stays connected.
used = collections.Counter()
for f in F:
    if f['properties'].get('highway') in CLS and f['geometry']['type'] == 'LineString':
        for c in set(map(tuple, f['geometry']['coordinates'])): used[c] += 1
SPEED = {'highway': 65, 'arterial': 35, 'minor': 35, 'collector': 30, 'ramp': 35, 'local': 25}  # mph, ASSUMED where OSM has no maxspeed
roads = []
for f in F:
    p = f['properties']; h = p.get('highway')
    if h not in CLS or f['geometry']['type'] != 'LineString': continue
    nm = p.get('name') or (p.get('ref') or '').replace(';', ' / ')
    if p.get('ref', '').startswith('US 20'): nm = 'US-20'
    raw = f['geometry']['coordinates']; cut = [i for i, c in enumerate(raw) if i in (0, len(raw)-1) or used[tuple(c)] > 1]
    pts = [P(*raw[0])]
    for i0, i1 in zip(cut, cut[1:]): pts += dp([P(x, y) for x, y in raw[i0:i1+1]], 2.0)[1:]
    jn = {tuple(P(*raw[i])) for i in cut}
    out = [pts[0]]
    for q in pts[1:]:
        a = out[-1]; L = math.hypot(q[0]-a[0], q[1]-a[1]); n = max(1, math.ceil(L / 200))
        for k in range(1, n+1): out.append([round(a[0]+(q[0]-a[0])*k/n), round(a[1]+(q[1]-a[1])*k/n)])
    ov = OVERRIDE.get(p.get('name')) or OVERRIDE.get(p.get('ref'))
    ow = p.get('oneway') in ('yes', '1', 'true') or h in ('motorway', 'motorway_link') and p.get('oneway') != 'no'
    try: ln = int(str(p.get('lanes', '')).split(';')[0])
    except ValueError: ln = 0
    ms = _re.match(r'(\d+)', str(p.get('maxspeed', '')))
    roads.append({'c': CLS[h], 'n': nm, 'pts': out, 'ov': ov, 'lanes': ln, 'ow': ow,
                  'node': [k for k, q in enumerate(out) if tuple(q) in jn], 'mph': int(ms.group(1)) if ms else SPEED[CLS[h]], 'mphb': 'osm' if ms else 'assumed'})
# nearest cross street for each segment (grid hash)
G = collections.defaultdict(list)
for ri, r in enumerate(roads):
    if not r['n']: continue
    for k in range(len(r['pts'])-1):
        a, b = r['pts'][k], r['pts'][k+1]; m = cen([a, b])
        G[(int(m[0]//300), int(m[1]//300))].append((ri, a, b))
nseg = 0
for ri, r in enumerate(roads):
    near = []
    for k in range(len(r['pts'])-1):
        m = cen([r['pts'][k], r['pts'][k+1]]); gx, gz = int(m[0]//300), int(m[1]//300); best = (1e9, '')
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for (rj, a, b) in G.get((gx+dx, gz+dz), []):
                    o = roads[rj]['n']
                    if o == r['n'] or not o: continue
                    d = segdist(m, a, b)
                    if d < best[0]: best = (d, o)
        near.append(ni(best[1]) if best[0] < 700 else ni(''))
        nseg += 1
    r['near'] = near

# ---------- lanes and real traffic counts ----------
DEFL = {'highway': 2, 'arterial': 2, 'minor': 2, 'collector': 2, 'ramp': 1, 'local': 2}
for r in roads:
    if r['ow']: thr = r['lanes'] or {'highway': 2, 'arterial': 2, 'minor': 2}.get(r['c'], 1)
    else: thr = (r['lanes'] if r['lanes'] % 2 == 0 else r['lanes'] - 1) if r['lanes'] else (4 if r['c'] == 'arterial' else DEFL[r['c']])
    r['thr'] = max(1, thr)
    r['lb'] = 'OpenStreetMap lanes tag' if r['lanes'] else ('assumed: untagged main road' if r['c'] in ('arterial', 'minor', 'highway') else 'assumed for road type')
    if r['n'] == 'North 2nd East': r['thr'] = 4; r['lb'] = 'widened to five lanes 2024-25 (city construction page)'
def core(n):
    n = n.lower().replace('.', '')
    n = _re.sub(r'^(north|south|east|west|n|s|e|w) ', '', n)
    n = _re.sub(r' (east|west|north|south|e|w|n|s)$', lambda m: ' ' + {'e': 'east', 'w': 'west', 'n': 'north', 's': 'south'}.get(m.group(1), m.group(1)), n)
    n = n.replace('street', 'st').replace('avenue', 'ave').replace('boulevard', 'blvd').replace('highway', 'hwy').replace('road', 'rd')
    return n.strip()
counts_used, counts_all = [], 0
GROW = 0.025
if EXTRA:
    import os
    TC = json.load(open(os.path.join(EXTRA, 'trafficcounts.json')))['features']
    segs = [(ri, k, r['pts'][k], r['pts'][k+1]) for ri, r in enumerate(roads) for k in range(len(r['pts'])-1)]
    for f in TC:
        q = f['properties']; counts_all += 1
        if not q.get('AADT') or not q.get('Year') or q['Year'] < 2015: continue
        pt = P(*f['geometry']['coordinates']); loc = (q.get('Location') or '').lower()
        if 'approach' in loc or _re.fullmatch(r'\d+(st|nd|rd|th) [nsew] \d+(st|nd|rd|th) [nsew]', loc.strip()): continue  # directional approach or intersection totals, not two-way street counts
        first = _re.split(r',| between | west of | east of | north of | south of | near | and | by | at |/|-', loc.replace('on ', ' ', 1).strip())[0].strip() if loc else ''
        first = _re.sub(r'^\d+ ', '', first) if _re.match(r'^\d{3,} ', first) else first
        best = None
        for (ri, k, a, b) in segs:
            d = segdist(pt, a, b)
            if d > 60: continue
            nm = roads[ri]['n']
            score = d - (40 if first and nm and core(nm) and (core(first) == core(nm) or core(first).split(' ')[0:2] == core(nm).split(' ')[0:2]) else 0)
            if best is None or score < best[0]: best = (score, ri, k, d)
        if not best: continue
        adj = round(q['AADT'] * (1 + GROW) ** (2026 - q['Year']))
        counts_used.append({'ri': best[1], 'k': best[2], 'aadt': q['AADT'], 'year': q['Year'], 'adj': adj, 'loc': q.get('Location') or '', 'pt': pt, 'name': roads[best[1]]['n'], 'cls': roads[best[1]]['c']})
    # per-segment ADT from the nearest count on the same street (within 1.5 km)
    bycore = collections.defaultdict(list)
    for c in counts_used:
        if c['name']: bycore[core(c['name'])].append(c)
    for r in roads:
        r['sadt'] = [0] * (len(r['pts']) - 1); r['sbasis'] = [''] * (len(r['pts']) - 1)
        cs = bycore.get(core(r['n']), []) if r['n'] else []
        for k in range(len(r['pts']) - 1):
            m = cen([r['pts'][k], r['pts'][k+1]]); best = None
            for c in cs:
                d = math.hypot(m[0] - c['pt'][0], m[1] - c['pt'][1])
                if d < 1500 and c['cls'] == r['c'] and (best is None or d < best[0]): best = (d, c)
            if best:
                c = best[1]; v = c['adj'] / (2 if r['ow'] else 1)
                r['sadt'][k] = round(v); r['sbasis'][k] = 'City count %d: %s a day%s' % (c['year'], format(c['aadt'], ','), (' (%s)' % c['loc']) if c['loc'] else '')
    # class medians from counts (for streets without a count)
    med = {}
    for cl in ('arterial', 'minor', 'collector'):
        v = sorted(c['adj'] for c in counts_used if roads[c['ri']]['c'] == cl)
        if len(v) >= 3: med[cl] = v[len(v)//2]
else:
    med = {}
    for r in roads: r['sadt'] = [0] * (len(r['pts']) - 1); r['sbasis'] = [''] * (len(r['pts']) - 1)

# ---------- 2023 intersection approach counts: a recent check (not used as street volumes or for tuning) ----------
# Each record counts one direction entering an intersection; its point sits on that leg. Location labels are sometimes
# wrong, so the intersection is found from the points (records within 60 m), and the leg from the point's offset.
# Two-way volume on the leg is ASSUMED to be about 2x the approach volume (traffic roughly balances over a day).
approach = []
if EXTRA:
    recs = []
    for f in TC:
        q = f['properties']; loc = (q.get('Location') or '')
        m = _re.search(r'\b(NB|SB|EB|WB) approach', loc)
        if m and q.get('AADT') and q.get('Year'): recs.append((P(*f['geometry']['coordinates']), m.group(1), q['AADT'], q['Year'], loc))
    segs_all = [(ri, k, r['pts'][k], r['pts'][k+1]) for ri, r in enumerate(roads) for k in range(len(r['pts'])-1)]
    for pt, d, aadt, yr, loc in recs:
        grp = [r[0] for r in recs if math.hypot(r[0][0]-pt[0], r[0][1]-pt[1]) < 60]
        cx, cz = sum(g[0] for g in grp) / len(grp), sum(g[1] for g in grp) / len(grp)
        ns = d in ('NB', 'SB'); side = {'NB': (0, 1), 'SB': (0, -1), 'EB': (-1, 0), 'WB': (1, 0)}[d]  # NB traffic arrives from the south (+z)
        best = None
        for ri, k, a, b in segs_all:
            if roads[ri]['c'] == 'ramp': continue
            dx, dz = b[0]-a[0], b[1]-a[1]
            if (abs(dz) > abs(dx)) != ns: continue
            m_ = cen([a, b]); along = (m_[0]-cx) * side[0] + (m_[1]-cz) * side[1]
            dd = segdist((cx, cz), a, b)
            if along <= 0 or dd > 40: continue
            if best is None or along < best[0]: best = (along, ri, k)
        if best: approach.append([round(cx), round(cz), aadt, yr, segbase_pre(best[1]) + best[2], round(2 * aadt * (1 + GROW) ** (2026 - yr)), d, loc])
    print('2023 approach counts matched to a street leg:', len(approach), 'of', len(recs))

# ---------- projects needing footprints (OSM buildings inside are hidden) ----------
mw = [q for r in roads if r['n'] == 'US-20' for q in r['pts']]
def mw_x(z): return min(mw, key=lambda q: abs(q[1]-z))[0]
madz = LL(43.8295, 0)[1]
FOOT = {  # center (meters) and size (meters)
  'madison': ([mw_x(madz) - 300, madz], [420, 480]),
  'whiteowl': (LL(43.8604, -111.7858), [320, 330]),
  'temple': (LL(43.86087, -111.78043), [75, 75]),
  'winco': (LL(43.8522, -111.7757), [190, 200]),
  'sundance': (LL(43.8224, -111.7846), [70, 55]),
  'library': (LL(43.81952, -111.78278), [95, 75]),
  'uoss': (LL(43.8042, -111.7985), [120, 80]),
}
def in_foot(c):
    for k, (m, s) in FOOT.items():
        if abs(c[0]-m[0]) < s[0]/2 and abs(c[1]-m[1]) < s[1]/2: return k
    return None

# ---------- areas ----------
univ = [ring(f) for f in F if f['properties'].get('amenity') == 'university' and f['properties'].get('name')]
campus = max(univ, key=area); cc = cen(campus)
xs = [p[0] for p in campus]; zs = [p[1] for p in campus]
walk = [min(xs)-250, min(zs)-250, max(xs)+250, max(zs)+250]
parks, water, lots, lines_w, rail = [], [], [], [], []
spaces_near, lots_near, spaces_all = 0, 0, 0
for f in F:
    p = f['properties']; g = f['geometry']['type']
    if p.get('amenity') == 'parking' and g == 'Polygon':
        r = dpring(ring(f), 1.5); A = area(r); sp = int(p['capacity']) if str(p.get('capacity', '')).isdigit() else round(A / 30)
        spaces_all += sp; lots.append(r)
        c = cen(r)
        if walk[0] <= c[0] <= walk[2] and walk[1] <= c[1] <= walk[3]: spaces_near += sp; lots_near += 1
    elif p.get('leisure') == 'park' and g == 'Polygon': parks.append(dpring(ring(f), 2))
    elif p.get('natural') == 'water' and g == 'Polygon': water.append(dpring(ring(f), 2))
    elif 'waterway' in p and g == 'LineString':
        w = {'river': 30, 'canal': 8, 'stream': 5}.get(p['waterway'], 3)
        lines_w.append([w] + [c for q in dp([P(x, y) for x, y in f['geometry']['coordinates']], 3) for c in q])
    elif p.get('railway') == 'rail' and g == 'LineString':
        rail.append([c for q in dp([P(x, y) for x, y in f['geometry']['coordinates']], 3) for c in q])

# ---------- city layers: walk district polygon, city projects, five-year street plan ----------
ped, widen, lids = None, [], []
if EXTRA:
    import os
    pf = json.load(open(os.path.join(EXTRA, 'ped.json')))['features'][0]['geometry']['coordinates'][0]
    ped = dpring([P(x, y) for x, y in pf][:-1], 2)
    xs2 = [p[0] for p in ped]; zs2 = [p[1] for p in ped]; walk = [min(xs2), min(zs2), max(xs2), max(zs2)]
    spaces_near = lots_near = 0
    for r in lots:
        c = cen(r)
        if inside(c, ped):
            lots_near += 1; spaces_near += round(area(r) / 30)
    seen = set()
    for f in json.load(open(os.path.join(EXTRA, 'projects.json')))['features']:
        q = f['properties']; g = f['geometry']
        if q.get('PROJSTATUS') != 'TBD' or 'idening' not in (q.get('PROJECTNAME') or '') + (q.get('PROJECTDESC') or ''): continue
        rings = [g['coordinates'][0]] if g['type'] == 'Polygon' else [pp[0] for pp in g['coordinates']]
        rr = [dpring([P(x, y) for x, y in rg][:-1], 3) for rg in rings]
        key = (q['PROJECTNAME'], tuple(cen(rr[0])))
        if key in seen: continue
        seen.add(key)
        widen.append({'id': 'w%d' % q['OBJECTID'], 'name': q['PROJECTNAME'].strip(), 'desc': (q.get('PROJECTDESC') or '').strip(),
                      'start': q.get('ESTPRJSTART'), 'impact': q.get('TRAFFICIMPACT') or q.get('PROGRESSINFO'), 'rings': [[v for p in r_ for v in p] for r_ in rr]})
    for f in json.load(open(os.path.join(EXTRA, 'streetplan.json')))['features']:
        q = f['properties']; g = f['geometry']
        ls = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        lids.append({'id': 'lid%s' % q['PROJECTNAME'].split()[-1], 'name': q['PROJECTNAME'], 'type': q.get('PROJECTTYPE'), 'year': int(q['PROJECTYEAR']),
                     'cost': int(float(q['ESTCOST'])) if q.get('ESTCOST') else None, 'where': q.get('COMMENTS') or '',
                     'lines': [[v for p in dp([P(x, y) for x, y in l], 3) for v in p] for l in ls]})

# ---------- buildings ----------
TYPE = {'house':0,'detached':0,'residential':0,'semidetached_house':0,'static_caravan':0,'apartments':1,'dormitory':1,
        'university':2,'commercial':3,'retail':3,'supermarket':3,'office':3,'church':4,'garage':5,'shed':5,'carport':5,'roof':5,
        'hangar':6,'warehouse':6,'industrial':6,'school':2,'hospital':3,'construction':5}
B = []; hidden = collections.Counter(); est = 0
for f in F:
    p = f['properties']
    if 'building' not in p or f['geometry']['type'] != 'Polygon': continue
    r = ring(f)
    if len(r) < 3: continue
    r = dpring(r, 0.8)
    if len(r) < 3: continue
    c = cen(r); k = in_foot(c)
    if k: hidden[k] += 1; continue
    A = area(r); t = TYPE.get(p['building'])
    if t is None: t = 2 if inside(c, campus) else (0 if A < 260 else 3)
    if p.get('height'):
        try: h = float(str(p['height']).split()[0])
        except ValueError: h = None
    else: h = None
    if h is None and str(p.get('building:levels', '')).replace('.', '').isdigit(): h = 3.2 * float(p['building:levels']) + 1
    if h is None:
        est += 1
        h = {0: 6, 1: 11, 2: 14, 3: 7 if A < 3000 else 9, 4: 10, 5: 3, 6: 8}[t]
        if t == 0 and A < 60: h = 3.5
    B.append([t, round(h)] + [v for q in r for v in q])

# ---------- strips for road-work projects ----------
def way_pts(nm_list, test):
    out = []
    for r in roads:
        if r['n'] in nm_list:
            seg = [q for q in r['pts'] if test(q)]
            if len(seg) > 1: out.append([v for q in seg for v in q])
    return out
x333 = LL(43.82614, -111.8114)[0]; x2e = LL(43.8260688, -111.7780703)[0]
z_yel = LL(43.841539, 0)[1]; z_7n = LL(43.840363, 0)[1]
STRIPS = {
  'mainst': way_pts(['West Main Street', 'East Main Street'], lambda q: x333 - 20 <= q[0] <= x2e + 10),
  'sewer2e': way_pts(['North 2nd East'], lambda q: z_yel - 30 <= q[1] <= z_7n + 30),
  'nysewer': way_pts(['North Yellowstone Highway'], lambda q: q[1] <= z_yel and q[1] >= LL(43.858, 0)[1]),
}
walmart = next(cen(ring(f)) for f in F if f['properties'].get('name') == 'Walmart Supercenter')
porter = next(cen(ring(f)) for f in F if f['properties'].get('name') == 'Porter Park')
river = [f for f in F if f['properties'].get('waterway') == 'river']
rv = P(*river[0]['geometry']['coordinates'][len(river[0]['geometry']['coordinates'])//2]) if river else None
CLSN = ['highway', 'arterial', 'minor', 'collector', 'ramp', 'local']
# ---------- road graph for routing: nodes at junctions and road ends, edges cover runs of street segments ----------
segbase, nb = [], 0
for r in roads: segbase.append(nb); nb += len(r['pts']) - 1
gnodes, gidx, gedges = [], {}, []
def gn(q):
    q = tuple(q)
    if q not in gidx: gidx[q] = len(gnodes); gnodes.append(q)
    return gidx[q]
for ri, r in enumerate(roads):
    ks = sorted(set(r['node']) | {0, len(r['pts']) - 1})
    for a, b in zip(ks, ks[1:]):
        L = sum(math.hypot(r['pts'][k+1][0]-r['pts'][k][0], r['pts'][k+1][1]-r['pts'][k][1]) for k in range(a, b))
        gedges.append([gn(r['pts'][a]), gn(r['pts'][b]), ri, segbase[ri] + a, segbase[ri] + b, round(max(L, 1)), round(r['mph'] * 0.44704, 2), 1 if r['ow'] else 0])
graph = {'meta': {'source': 'Road graph built from OpenStreetMap intersections; speeds from maxspeed tags, else assumed by road type', 'url': 'https://www.openstreetmap.org/copyright', 'fetched': '2026-11-14', 'type': 'real'},
         'nodes': [v for q in gnodes for v in q], 'edges': gedges, 'speedBasis': {'osm': sum(1 for r in roads if r['mphb'] == 'osm'), 'assumed': sum(1 for r in roads if r['mphb'] == 'assumed')}}
# ---------- named places for map search: buildings and parks from the export, plus shopping centers, parks,
# schools, churches and neighborhoods from areas.json (Overpass: named landuse=retail|commercial, shop=mall, place,
# leisure, and amenity=school|college|university|hospital|library|townhall|community_centre|place_of_worship; out center) ----------
BKIND = {'university': 'campus', 'church': 'church', 'temple': 'church', 'chapel': 'church', 'school': 'school', 'apartments': 'apartments',
         'dormitory': 'apartments', 'hospital': 'civic', 'government': 'civic', 'retail': 'shop', 'commercial': 'business', 'hotel': 'business'}
def poi_kind(p):
    if p.get('shop') == 'mall' or p.get('landuse') in ('retail', 'commercial'): return 'center'
    if 'place' in p: return 'place'
    if p.get('leisure') in ('park', 'garden', 'playground', 'nature_reserve'): return 'park'
    if 'leisure' in p: return 'rec'
    a = p.get('amenity')
    if a == 'place_of_worship': return 'church'
    if a in ('school', 'college', 'university'): return 'school' if a == 'school' else 'campus'
    if a: return 'civic'
    if 'building' in p: return BKIND.get(p['building'], 'building')
    if p.get('natural') == 'water': return 'water'
    return None
pois = []
def add_poi(name, kind, pt):
    if not name or not kind or _re.match(r'^Building \d+$', name): return  # numbered blocks of one complex say nothing alone
    for q in pois:  # the same place mapped twice (outline and point, or two outlines)
        if q[0].lower() == name.lower() and math.hypot(q[2] - pt[0], q[3] - pt[1]) < 250: return
    pois.append([name, kind, round(pt[0]), round(pt[1])])
for f in F:
    p, g = f['properties'], f['geometry']
    if 'highway' in p or 'railway' in p or 'waterway' in p or not p.get('name'): continue
    if g['type'] == 'Polygon': c = cen(ring(f))
    elif g['type'] == 'MultiPolygon': c = cen([P(x, y) for x, y in g['coordinates'][0][0]])
    elif g['type'] == 'Point': c = P(*g['coordinates'])
    else: continue
    add_poi(p['name'], poi_kind(p), c)
if EXTRA and os.path.exists(os.path.join(EXTRA, 'areas.json')):
    for e in json.load(open(os.path.join(EXTRA, 'areas.json'), encoding='utf-8'))['elements']:
        c = e.get('center') or ({'lat': e['lat'], 'lon': e['lon']} if 'lat' in e else None)
        if c: add_poi(e['tags'].get('name'), poi_kind(e['tags']), LL(c['lat'], c['lon']))

# ---------- traffic signals: OSM highway=traffic_signals nodes, one per approach at some intersections ----------
# signals.json is an Overpass answer: [out:json];node["highway"="traffic_signals"](43.775,-111.845,43.865,-111.74);out;
signals = []
if EXTRA and os.path.exists(os.path.join(EXTRA, 'signals.json')):
    groups = []  # nodes within 60 m of a group's center are the same intersection
    for e in json.load(open(os.path.join(EXTRA, 'signals.json')))['elements']:
        p = LL(e['lat'], e['lon'])
        g = next((g for g in groups if math.hypot(cen(g)[0]-p[0], cen(g)[1]-p[1]) < 60), None)
        if g: g.append(p)
        else: groups.append([p])
    signals = [[round(cen(g)[0]), round(cen(g)[1]), len(g)] for g in groups]
city = {
  'name': 'Rexburg, Idaho', 'origin': [LAT0, LON0], 'kx': KX, 'kz': KZ,
  'bbox': [43.775, -111.845, 43.865, -111.740], 'fetched': '2026-11-14',
  'names': names, 'cls': CLSN,
  'roads': [[CLSN.index(r['c']), ni(r['n']), (r['ov'][0] if r['ov'] else 0), (ni(r['ov'][1]) if r['ov'] else ni('')), [v for q in r['pts'] for v in q], r['near'],
             r['thr'], 1 if r['ow'] else 0, ni(r['lb']), r['sadt'], [ni(b) for b in r['sbasis']], r['mph'], 1 if r['mphb'] == 'osm' else 0] for r in roads],
  'classAdt': med, 'counts': {'used': len(counts_used), 'records': counts_all, 'growth': GROW,
             'pts': [[c['pt'][0], c['pt'][1], c['aadt'], c['year'], segbase[c['ri']] + c['k'], c['adj']] for c in counts_used],
             'approach': approach},  # x, z, approach count, year, leg segment, two-way leg estimate grown to 2026, direction, label
  'buildings': B, 'lots': [[v for q in r for v in q] for r in lots], 'parks': [[v for q in r for v in q] for r in parks],
  'water': [[v for q in r for v in q] for r in water], 'waterways': lines_w, 'rail': rail,
  'campus': [v for q in campus for v in q], 'walk': walk, 'ped': [v for q in ped for v in q] if ped else None, 'widenings': widen, 'streetplan': lids, 'foot': FOOT, 'strips': STRIPS,
  'signals': signals,  # x, z, OSM signal nodes at the intersection
  'pois': pois,  # name, kind, x, z: named buildings, parks, shopping centers and areas for map search
  'places': {'campus': cc, 'walmart': walmart, 'porter': porter, 'river': rv, 'exit333': LL(43.82614, -111.8114), 'exit332': LL(43.8045659, -111.8129931)},
  'parking': {'lots': len(lots), 'spacesAll': spaces_all, 'lotsNear': lots_near, 'spacesNear': spaces_near, 'perSpace': 30},
  'stats': {'roads': len(roads), 'segments': nseg, 'signals': len(signals), 'buildings': len(B), 'heightsEstimated': est, 'hidden': dict(hidden)}
}
city['meta'] = {'source': 'OpenStreetMap via Overpass Turbo (c) OpenStreetMap contributors, ODbL; Madison County / Rexburg GIS layers',
                'url': 'https://www.openstreetmap.org/copyright', 'fetched': '2026-11-14', 'type': 'real'}
s = json.dumps(city, separators=(',', ':'))
if OUT.endswith('.js'):
    open(OUT, 'w').write('/* Rexburg from OpenStreetMap (c) OpenStreetMap contributors, ODbL. Generated by build_city.py */\nwindow.OSM_CITY=' + s + ';\n')
else:  # a folder: write city-rexburg.json for the React app
    import os
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, 'city-rexburg.json'), 'w').write(s)
    open(os.path.join(OUT, 'graph-rexburg.json'), 'w').write(json.dumps(graph, separators=(',', ':')))
    print('graph', len(gnodes), 'nodes', len(gedges), 'edges', json.dumps(graph['speedBasis']))
print(json.dumps(city['classAdt']), json.dumps({k: v for k, v in city['counts'].items() if k != 'pts'}), len(widen), 'widenings', len(lids), 'lids')
print(json.dumps(city['stats']), json.dumps(city['parking']), 'bytes', len(s), 'campus', [round(v) for v in cc], 'walk', walk)
