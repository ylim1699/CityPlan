"""Download ACS 5-year (2020-2024) tables for Madison County, Idaho, by block group, into data/raw/acs/.
Usage: python -I scripts/fetch_census.py        (reads CENSUS_API_KEY from .env; the key is never printed or saved)
Tables: B01003 population, B08301 means of transportation to work (with carpool sizes), B25044 vehicles available."""
import json, os, urllib.request, urllib.parse

def env_key():
    for line in open('.env', encoding='utf-8'):
        if line.strip().startswith('CENSUS_API_KEY='): return line.split('=', 1)[1].strip().strip('"\'')
    raise SystemExit('CENSUS_API_KEY not found in .env')
KEY, YEAR = env_key(), 2024
OUT = 'data/raw/acs'
os.makedirs(OUT, exist_ok=True)
TABLES = {
    'B01003': ['B01003_001E'],
    'B08301': ['B08301_%03dE' % i for i in range(1, 22)],   # 001 total workers ... 021 worked from home
    'B25044': ['B25044_%03dE' % i for i in range(1, 16)],   # occupied units by tenure x vehicles available
}
for t, vars_ in TABLES.items():
    q = urllib.parse.urlencode({'get': 'NAME,' + ','.join(vars_), 'for': 'block group:*', 'in': 'state:16 county:065 tract:*', 'key': KEY})
    with urllib.request.urlopen('https://api.census.gov/data/%d/acs/acs5?%s' % (YEAR, q), timeout=60) as r:
        rows = json.load(r)
    meta = {'source': 'U.S. Census Bureau, ACS 5-year %d-%d, table %s, block groups, Madison County ID' % (YEAR - 4, YEAR, t),
            'url': 'https://api.census.gov/data/%d/acs/acs5' % YEAR, 'fetched': '2026-11-14', 'type': 'real'}
    json.dump({'meta': meta, 'rows': rows}, open(os.path.join(OUT, '%s_bg.json' % t), 'w'))
    print(t, len(rows) - 1, 'block groups')
