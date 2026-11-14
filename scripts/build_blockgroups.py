"""Census block groups for the map's hover layer: boundaries joined to their Census numbers. Writes public/data/blockgroups.json.
Usage: python -I scripts/build_blockgroups.py public/data data/raw/acs      (run scripts/fetch_census.py first)
Counts are as published, not scaled or spread: 2020 Census full count (P1), ACS 2020-2024 estimates with their 90% margins
of error (population, housing units, median age, college enrollment), and commute and car figures from ACS B08301 / B25044."""
import json, math, os, sys
OUT, ACS = sys.argv[1], sys.argv[2]
C = json.load(open(os.path.join(OUT, 'city-rexburg.json')))
LAT0, LON0 = C['origin']; KX, KZ = C['kx'], C['kz']
S, W, N, E = C['bbox']
def P(lon, lat): return [(lon - LON0) * KX, -(lat - LAT0) * KZ]

def table(name):
    d = json.load(open(os.path.join(ACS, name)))
    h, rows = d['rows'][0], d['rows'][1:]
    out = {}
    for r in rows:
        v = dict(zip(h, r))
        out[v['state'] + v['county'] + v['tract'] + v['block group']] = {k: (float(x) if x not in (None, '') and k[:1] in 'BP' else x) for k, x in v.items()}
    return out, d['meta']
def num(v):  # the Census API marks unavailable values with large negative codes
    return None if v is None or v < -1e5 else v

pop, m1 = table('B01003_bg.json'); p20, m2 = table('P1_2020_bg.json'); hu, m3 = table('B25001_bg.json')
age, m4 = table('B01002_bg.json'); col, m5 = table('B14007_bg.json'); b83, m6 = table('B08301_bg.json'); b25, m7 = table('B25044_bg.json')
shapes = json.load(open(os.path.join(ACS, 'bg_shapes.json')))

def dp(pts, eps):  # Douglas-Peucker on [x, z] points
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz) or 1e-9
    i, dm = 0, -1
    for k in range(1, len(pts) - 1):
        d = abs(dz * (pts[k][0] - a[0]) - dx * (pts[k][1] - a[1])) / L
        if d > dm: i, dm = k, d
    return dp(pts[:i + 1], eps)[:-1] + dp(pts[i:], eps) if dm > eps else [a, b]
def dpring(pts, eps):  # a closed ring starts and ends on the same point, so simplify its two halves
    r = pts[:-1]; k = len(r) // 2
    return dp(r[:k + 1], eps)[:-1] + dp(r[k:] + [r[0]], eps)[:-1]
def area(r): return abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2
def centroid(r):
    a = cx = cz = 0
    for i in range(len(r)):
        x0, z0 = r[i - 1]; x1, z1 = r[i]; f = x0 * z1 - x1 * z0; a += f; cx += (x0 + x1) * f; cz += (z0 + z1) * f
    return [round(cx / (3 * a)), round(cz / (3 * a))] if a else r[0]

out = []
for f in shapes['features']:
    q, g = f['properties'], f['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    lons = [p[0] for poly in polys for p in poly[0]]; lats = [p[1] for poly in polys for p in poly[0]]
    if max(lons) < W or min(lons) > E or max(lats) < S or min(lats) > N: continue   # outside the map
    rings = []
    for poly in polys:
        r = dpring([P(lon, lat) for lon, lat in poly[0]], 4)
        if len(r) >= 3: rings.append(r)
    gid = q['GEOID']; t = gid[5:11]
    p, pc, h, a, c, w, v = pop.get(gid, {}), p20.get(gid, {}), hu.get(gid, {}), age.get(gid, {}), col.get(gid, {}), b83.get(gid), b25.get(gid)
    land = q['AREALAND'] / 1e6
    college = colm = None
    if c:
        college = c['B14007_017E'] + c['B14007_018E']; colm = round(math.hypot(c['B14007_017M'], c['B14007_018M']))
    commute = None
    if w and w['B08301_001E']:
        tot = w['B08301_001E']
        commute = {'workers': int(tot), 'drive': round(w['B08301_002E'] / tot, 3), 'transit': round(w['B08301_010E'] / tot, 3), 'bike': round(w['B08301_018E'] / tot, 3),
                   'walk': round(w['B08301_019E'] / tot, 3), 'wfh': round(w['B08301_021E'] / tot, 3)}
    cars = None
    if v and v['B25044_001E']:
        hh = v['B25044_001E']
        n = sum(v['B25044_%03dE' % i] * k for k, i in [(1, 4), (2, 5), (3, 6), (4, 7), (5, 8), (1, 11), (2, 12), (3, 13), (4, 14), (5, 15)])
        cars = {'households': int(hh), 'perHH': round(n / hh, 2), 'zeroCar': round((v['B25044_003E'] + v['B25044_010E']) / hh, 3)}
    big = max(rings, key=area)
    out.append({
        'id': gid, 'name': 'Block group %s, tract %s' % (q['BLKGRP'], t[:4].lstrip('0') + ('.' + t[4:] if t[4:] != '00' else '')),
        'rings': [[v for pt in r for v in (round(pt[0]), round(pt[1]))] for r in rings], 'at': centroid(big),
        'landKm2': round(land, 3), 'waterKm2': round(q['AREAWATER'] / 1e6, 3),
        'pop2020': int(pc['P1_001N']) if pc else None,
        'pop': num(p.get('B01003_001E')), 'popMoe': num(p.get('B01003_001M')),
        'homes': num(h.get('B25001_001E')), 'homesMoe': num(h.get('B25001_001M')),
        'medAge': num(a.get('B01002_001E')), 'medAgeMoe': num(a.get('B01002_001M')),
        'college': college, 'collegeMoe': colm, 'commute': commute, 'cars': cars
    })
out.sort(key=lambda b: b['id'])
meta = {'source': '; '.join(m['source'] for m in (m2, m1, m3, m4, m5, m6, m7)) + '; boundaries: ' + shapes['meta']['source'],
        'url': 'https://api.census.gov/data/2024/acs/acs5', 'fetched': shapes['meta']['fetched'], 'type': 'real'}
json.dump({'meta': meta, 'notes': 'ACS figures are 5-year sample estimates with 90% margins of error (popMoe etc.); pop2020 is the 2020 Census full count.',
           'groups': out}, open(os.path.join(OUT, 'blockgroups.json'), 'w'), separators=(',', ':'))
print(len(out), 'block groups on the map;', sum(b['pop'] or 0 for b in out), 'people (ACS),', sum(b['pop2020'] or 0 for b in out), '(2020 Census)')
