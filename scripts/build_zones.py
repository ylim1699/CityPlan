"""Zones for the traffic model: census blocks (LODES crosswalk points) grouped by block group and a 1.2 km grid,
plus a campus zone and gateway zones where main roads leave town. Writes public/data/zones.json.
Usage: python -I scripts/build_zones.py public/data data/raw/lodes
Residents and students per zone come from building floor area (ESTIMATE, scaled to the city totals);
workers (RAC), jobs (WAC) and home-to-work pairs (OD) are real LODES 2023 counts."""
import csv, gzip, json, math, os, sys, collections
OUT, LODES = sys.argv[1], sys.argv[2]
C = json.load(open(os.path.join(OUT, 'city-rexburg.json')))
G = json.load(open(os.path.join(OUT, 'graph-rexburg.json')))
LAT0, LON0 = C['origin']; KX, KZ = C['kx'], C['kz']
def P(lon, lat): return [(lon - LON0) * KX, -(lat - LAT0) * KZ]
S, W, N, E = C['bbox']
R0, S0 = 22100, 21900   # city totals the zones must add up to (same as the model's POP.R0 and POP.S0)
GRID = 1200
def inside(p, r):
    x, z = p; c = False; j = len(r) - 1
    for i in range(len(r)):
        xi, zi = r[i]; xj, zj = r[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi: c = not c
        j = i
    return c
def ring(fl): return [(fl[k], fl[k + 1]) for k in range(0, len(fl), 2)]
campus, ped = ring(C['campus']), ring(C['ped'])

# ---------- blocks in the study area ----------
blocks, bpos, bzone = {}, {}, {}
with gzip.open(os.path.join(LODES, 'id_xwalk.csv.gz'), 'rt') as f:
    for row in csv.DictReader(f):
        lat, lon = float(row['blklatdd']), float(row['blklondd'])
        bpos[row['tabblk2020']] = P(lon, lat)
        if row['cty'] == '16065' and S <= lat <= N and W <= lon <= E: blocks[row['tabblk2020']] = row['bgrp']
for b, bg in blocks.items():
    p = bpos[b]
    bzone[b] = 'campus' if inside(p, campus) else '%s-%d-%d' % (bg[-4:], math.floor(p[0] / GRID), math.floor(p[1] / GRID))

# ---------- residents and students from building floor area ----------
H = collections.defaultdict(list)
for b in blocks:
    if bzone[b] != 'campus': p = bpos[b]; H[(int(p[0] // 500), int(p[1] // 500))].append(b)  # homes go to town zones, never campus
def nearest_block(p):
    gx, gz = int(p[0] // 500), int(p[1] // 500); best = (1e18, None)
    for r in (1, 2, 4):
        for dx in range(-r, r + 1):
            for dz in range(-r, r + 1):
                for b in H.get((gx + dx, gz + dz), []):
                    q = bpos[b]; d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
                    if d < best[0]: best = (d, b)
        if best[1]: return best[1]
    return None
def area(r):
    s = 0
    for i in range(len(r)): x1, z1 = r[i]; x2, z2 = r[(i + 1) % len(r)]; s += x1 * z2 - x2 * z1
    return abs(s) / 2
res_w, stu_w = collections.Counter(), collections.Counter()
for bld in C['buildings']:
    t, h, r = bld[0], bld[1], ring(bld[2:])
    if t not in (0, 1, 3): continue
    cx = sum(p[0] for p in r) / len(r); cz = sum(p[1] for p in r) / len(r)
    if inside((cx, cz), campus): continue
    floors = max(1, round(h / 3.3)); fa = area(r) * floors
    b = nearest_block((cx, cz))
    if not b: continue
    z = bzone[b]
    if inside((cx, cz), ped) and t in (1, 3): stu_w[z] += fa       # apartments and large untagged buildings in the walk district: student housing (ASSUMED)
    elif t in (0, 1): res_w[z] += fa

# ---------- ACS 5-year 2020-2024 by block group (scripts/fetch_census.py), when downloaded ----------
# Population: each block group's ACS count is spread over its zones by building floor area, keeping each zone's
# student / resident split from the building types. Commute: drive share, car occupancy and work-from-home per block group,
# blended toward the county value when the block group sample is small.
ACS = os.path.join(os.path.dirname(LODES), 'acs')
acs = {}
if os.path.exists(os.path.join(ACS, 'B08301_bg.json')):
    def table(t):
        rows = json.load(open(os.path.join(ACS, t + '_bg.json')))['rows']; h = rows[0]
        return {r[h.index('state')] + r[h.index('county')] + r[h.index('tract')] + r[h.index('block group')]: {k: float(v or 0) for k, v in zip(h, r) if k.startswith(t)} for r in rows[1:]}
    pop, b83, b25 = table('B01003'), table('B08301'), table('B25044')
    def commute(v):
        car, tot, wfh = v['B08301_002E'], v['B08301_001E'], v['B08301_021E']
        veh = v['B08301_003E'] + v['B08301_005E'] / 2 + v['B08301_006E'] / 3 + v['B08301_007E'] / 4 + v['B08301_008E'] / 5.5 + v['B08301_009E'] / 7
        return {'n': tot, 'drive': car / max(1, tot - wfh), 'occ': car / max(1, veh), 'wfh': wfh / max(1, tot), 'walk': v['B08301_019E'] / max(1, tot)}
    county = commute({k: sum(v[k] for v in b83.values()) for k in next(iter(b83.values()))})
    def vehicles(v):
        n = sum(v['B25044_%03dE' % i] * k for k, i in [(1, 4), (2, 5), (3, 6), (4, 7), (5, 8), (1, 11), (2, 12), (3, 13), (4, 14), (5, 15)])
        return n / max(1, v['B25044_001E']), (v['B25044_003E'] + v['B25044_010E']) / max(1, v['B25044_001E'])
    for bg, v in b83.items():
        c = commute(v); w = c['n'] / (c['n'] + 300)  # small samples lean on the county value
        vh, zc = vehicles(b25.get(bg, {'B25044_%03dE' % i: 0 for i in range(1, 16)}))
        acs[bg] = {k: round(w * c[k] + (1 - w) * county[k], 3) for k in ('drive', 'occ', 'wfh', 'walk')}
        acs[bg].update({'vehPerHH': round(vh, 2), 'zeroCar': round(zc, 3), 'pop': pop.get(bg, {}).get('B01003_001E', 0)})
    acs['county'] = {k: round(county[k], 3) for k in ('drive', 'occ', 'wfh', 'walk')}
    zbg = {}
    for b, z in bzone.items(): zbg.setdefault(z, collections.Counter())[blocks[b]] += 1
    zbg = {z: c.most_common(1)[0][0] for z, c in zbg.items()}
    bgfa = collections.Counter()
    for z in set(res_w) | set(stu_w): bgfa[zbg.get(z)] += res_w[z] + stu_w[z]
    for z in set(res_w) | set(stu_w):
        fa = res_w[z] + stu_w[z]; bg = zbg.get(z)
        if not fa or bg not in acs or not bgfa[bg]: continue
        tot = acs[bg]['pop'] * fa / bgfa[bg]
        res_w[z], stu_w[z] = tot * res_w[z] / fa, tot * stu_w[z] / fa
    print('ACS: county drive share of commuters %.1f%%, occupancy %.2f, work from home %.1f%%, walk %.1f%%' % (county['drive'] * 100, county['occ'], county['wfh'] * 100, county['walk'] * 100))
rs, ss = sum(res_w.values()), sum(stu_w.values())

# ---------- LODES: workers by home, jobs by work place, home-to-work pairs ----------
def lodes(fn):
    with gzip.open(os.path.join(LODES, fn), 'rt') as f: yield from csv.DictReader(f)
workers, jobs = collections.Counter(), collections.defaultdict(lambda: [0, 0, 0])
for row in lodes('id_rac_S000_JT00_2023.csv.gz'):
    if row['h_geocode'] in blocks: workers[bzone[row['h_geocode']]] += int(row['C000'])
for row in lodes('id_wac_S000_JT00_2023.csv.gz'):
    if row['w_geocode'] in blocks:
        j = jobs[bzone[row['w_geocode']]]; j[0] += int(row['CNS07']); j[1] += int(row['CNS15']); j[2] += int(row['C000']) - int(row['CNS07']) - int(row['CNS15'])

# ---------- gateways: road ends on main roads near the edge of the map ----------
cls = C['cls']; ncls = collections.defaultdict(set); deg = collections.Counter()
for e in G['edges']:
    c = cls[C['roads'][e[2]][0]]; ncls[e[0]].add(c); ncls[e[1]].add(c); deg[e[0]] += 1; deg[e[1]] += 1
nxy = [(G['nodes'][2 * i], G['nodes'][2 * i + 1]) for i in range(len(G['nodes']) // 2)]
counted = {p[4]: p[5] for p in C['counts']['pts']}
def edge_aadt(e):
    best = None
    for s in range(e[3], e[4]):
        if s in counted: best = max(best or 0, counted[s])
    r = C['roads'][e[2]]
    return best or r[2] or {'highway': 21500, 'arterial': 12000, 'minor': 7000, 'collector': 4000}.get(cls[r[0]], 2000)
gw = []
for e in G['edges']:
    c = cls[C['roads'][e[2]][0]]
    if c not in ('highway', 'arterial', 'minor', 'collector'): continue
    for n in (e[0], e[1]):
        x, z = nxy[n]
        if deg[n] == 1 and math.hypot(x, z) > (4500 if c == 'collector' else 3500):
            name = C['names'][C['roads'][e[2]][1]] or c
            gw.append({'node': n, 'x': x, 'z': z, 'road': name, 'cls': c, 'aadt': edge_aadt(e)})  # counts and road defaults are two-way daily totals
# one gateway per road and direction (motorway carriageways come in pairs)
gws = []
for g in sorted(gw, key=lambda g: -g['aadt']):
    if any(math.hypot(g['x'] - h['x'], g['z'] - h['z']) < (2500 if g['road'] == h['road'] else 900) for h in gws): continue
    gws.append(g)
for g in gws:
    b = math.degrees(math.atan2(g['x'], -g['z'])) % 360
    g['dir'] = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][int((b + 22.5) // 45) % 8]
    g['id'] = 'gw-' + g['dir'] + '-' + ''.join(ch for ch in g['road'].lower() if ch.isalnum())[:12]
def gateway_for(p):
    a = math.atan2(p[0], -p[1]); best = None
    for g in gws:
        d = abs((math.atan2(g['x'], -g['z']) - a + math.pi) % (2 * math.pi) - math.pi) - 0.15 * (g['cls'] == 'highway')
        if best is None or d < best[0]: best = (d, g['id'])
    return best[1]
def far_gateway(): return max(gws, key=lambda g: g['aadt'])['id']

od = collections.Counter()
for fn in ('id_od_main_JT00_2023.csv.gz', 'id_od_aux_JT00_2023.csv.gz'):
    for row in lodes(fn):
        h, w = row['h_geocode'], row['w_geocode']
        hi, wi = h in blocks, w in blocks
        if not (hi or wi): continue
        hz = bzone[h] if hi else (gateway_for(bpos[h]) if h in bpos else far_gateway())
        wz = bzone[w] if wi else (gateway_for(bpos[w]) if w in bpos else far_gateway())
        od[(hz, wz)] += int(row['S000'])

# ---------- zone records ----------
zb = collections.defaultdict(list)
for b, z in bzone.items(): zb[z].append(bpos[b])
road_nodes = [i for i in range(len(nxy)) if ncls[i] - {'highway', 'ramp'}]
main_nodes = [i for i in range(len(nxy)) if ncls[i] & {'arterial', 'minor', 'collector'}]
def connector(x, z, main=False): return min(main_nodes if main else road_nodes, key=lambda i: (nxy[i][0] - x) ** 2 + (nxy[i][1] - z) ** 2)
def connectors(x, z):  # up to 3 street points within 700 m, so a zone's trips can leave by more than one street
    near = sorted(road_nodes, key=lambda i: (nxy[i][0] - x) ** 2 + (nxy[i][1] - z) ** 2)
    return [near[0]] + [i for i in near[1:3] if math.hypot(nxy[i][0] - x, nxy[i][1] - z) < 700]
zones = []
for z, pts in sorted(zb.items()):
    x = sum(p[0] for p in pts) / len(pts); zz = sum(p[1] for p in pts) / len(pts)
    if z == 'campus': x, zz = sum(p[0] for p in campus) / len(campus), sum(p[1] for p in campus) / len(campus)
    j = jobs.get(z, [0, 0, 0])
    if z == 'campus':
        # Campus is split by its parking lots (by direction from the campus center), each part connected to the nearest street
        # that is not a local street, so campus traffic enters from several sides as it does in reality.
        parts = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
        for lot in C['lots']:
            r = ring(lot); lx = sum(q[0] for q in r) / len(r); lz = sum(q[1] for q in r) / len(r)
            if not (inside((lx, lz), campus) or min(math.hypot(lx - q[0], lz - q[1]) for q in campus) < 150): continue
            a = area(r); k = ['north', 'east', 'south', 'west'][int(((math.degrees(math.atan2(lx - x, -(lz - zz))) + 45) % 360) // 90)]
            parts[k][0] += a; parts[k][1] += lx * a; parts[k][2] += lz * a
        tot = sum(v[0] for v in parts.values())
        for k, (a, sx, sz) in sorted(parts.items()):
            px, pz = sx / a, sz / a
            zones.append({'id': 'campus-' + k, 'kind': 'campus', 'share': round(a / tot, 3), 'x': round(px), 'z': round(pz), 'node': connector(px, pz, main=True),
                          'residents': 0, 'students': 0, 'workers': 0, 'jobs': {'retail': round(j[0] * a / tot), 'edu': round(j[1] * a / tot), 'other': round(j[2] * a / tot)},
                          'inPed': True, 'blocks': len(pts)})
        continue
    cn = connectors(x, zz)
    zones.append({'id': z, 'kind': 'town', 'x': round(x), 'z': round(zz), 'node': cn[0], 'nodes': cn,
                  'residents': round(R0 * res_w[z] / rs, 1), 'students': round(S0 * stu_w[z] / ss, 1), 'workers': workers[z],
                  **({'acs': {k: v for k, v in acs[zbg[z]].items() if k != 'pop'}} if acs and zbg.get(z) in acs else {}),
                  'jobs': {'retail': j[0], 'edu': j[1], 'other': j[2]}, 'inPed': inside((x, zz), ped), 'blocks': len(pts)})
for g in gws:
    zones.append({'id': g['id'], 'kind': 'gateway', 'x': round(g['x']), 'z': round(g['z']), 'node': g['node'], 'road': g['road'], 'aadt': g['aadt'],
                  'residents': 0, 'students': 0, 'workers': 0, 'jobs': {'retail': 0, 'edu': 0, 'other': 0}, 'inPed': False, 'blocks': 0})
ids = {z['id']: i for i, z in enumerate(zones)}
out = {'meta': {'source': 'LEHD LODES 2023 (OD main + aux, WAC, RAC, block crosswalk); Census ACS 5-year 2020-2024 (B01003, B08301, B25044) by block group; OpenStreetMap building floor area',
                'url': 'https://lehd.ces.census.gov/data/', 'fetched': '2026-11-14', 'type': 'real'},
       'notes': 'Residents/students per zone: ACS 2020-2024 block group population spread by building floor area (student/resident split is an ESTIMATE from building types), scaled to city totals; commute mode per zone from ACS B08301; workers, jobs and commute pairs are LODES counts.',
       'acsCounty': acs.get('county'),
       'zones': zones, 'work': []}
camp = [(ids[z['id']], z['share']) for z in zones if z['kind'] == 'campus']
work = collections.Counter()
for (h, w), n in od.items():
    hs = camp if h == 'campus' else [(ids[h], 1)] if h in ids else []
    ws = camp if w == 'campus' else [(ids[w], 1)] if w in ids else []
    for hi, a in hs:
        for wi, b in ws: work[(hi, wi)] += n * a * b
out['work'] = [[h, w, round(n, 2)] for (h, w), n in sorted(work.items())]
open(os.path.join(OUT, 'zones.json'), 'w').write(json.dumps(out, separators=(',', ':')))
print(len(zones), 'zones:', sum(z['kind'] == 'town' for z in zones), 'town,', len(gws), 'gateways', [(g['id'], g['aadt']) for g in gws])
print('residents', round(sum(z['residents'] for z in zones)), 'students', round(sum(z['students'] for z in zones)), 'workers', sum(workers.values()),
      'jobs', sum(sum(j) for j in jobs.values()), 'work pairs', len(out['work']), 'commuters', sum(n for (h, w), n in od.items()))
