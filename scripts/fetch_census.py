"""Download Census data for Madison County, Idaho, by block group, into data/raw/acs/.
Usage: python -I scripts/fetch_census.py        (reads CENSUS_API_KEY from .env; the key is never printed or saved)
ACS 5-year (2020-2024) tables: B01003 population (with margin of error), B08301 means of transportation to work
(with carpool sizes), B25044 vehicles available, B25001 housing units, B01002 median age, B14007 school enrollment
(college undergraduate and graduate). 2020 Census P1: the full count of people, not a sample estimate.
Block group boundaries come from the Census Bureau's TIGERweb service (the ACS 2024 vintage, same block groups)."""
import json, os, urllib.request, urllib.parse

def env_key():
    for line in open('.env', encoding='utf-8'):
        if line.strip().startswith('CENSUS_API_KEY='): return line.split('=', 1)[1].strip().strip('"\'')
    raise SystemExit('CENSUS_API_KEY not found in .env')
KEY, YEAR = env_key(), 2024
OUT = 'data/raw/acs'
os.makedirs(OUT, exist_ok=True)
FETCHED = '2026-11-14'
TABLES = {
    'B01003': ['B01003_001E', 'B01003_001M'],
    'B08301': ['B08301_%03dE' % i for i in range(1, 22)],   # 001 total workers ... 021 worked from home
    'B25044': ['B25044_%03dE' % i for i in range(1, 16)],   # occupied units by tenure x vehicles available
    'B25001': ['B25001_001E', 'B25001_001M'],               # housing units
    'B01002': ['B01002_001E', 'B01002_001M'],               # median age
    'B14007': ['B14007_001E', 'B14007_017E', 'B14007_017M', 'B14007_018E', 'B14007_018M'],  # age 3+; enrolled in college, undergraduate / graduate
}
def get(url):
    with urllib.request.urlopen(url, timeout=90) as r: return json.load(r)
def save(name, meta, data):
    json.dump({'meta': meta, **data}, open(os.path.join(OUT, name), 'w'))

for t, vars_ in TABLES.items():
    q = urllib.parse.urlencode({'get': 'NAME,' + ','.join(vars_), 'for': 'block group:*', 'in': 'state:16 county:065 tract:*', 'key': KEY})
    rows = get('https://api.census.gov/data/%d/acs/acs5?%s' % (YEAR, q))
    save('%s_bg.json' % t, {'source': 'U.S. Census Bureau, ACS 5-year %d-%d, table %s, block groups, Madison County ID' % (YEAR - 4, YEAR, t),
                            'url': 'https://api.census.gov/data/%d/acs/acs5' % YEAR, 'fetched': FETCHED, 'type': 'real'}, {'rows': rows})
    print(t, len(rows) - 1, 'block groups')

q = urllib.parse.urlencode({'get': 'NAME,P1_001N', 'for': 'block group:*', 'in': 'state:16 county:065 tract:*', 'key': KEY})
rows = get('https://api.census.gov/data/2020/dec/pl?' + q)
save('P1_2020_bg.json', {'source': 'U.S. Census Bureau, 2020 Census redistricting data (P.L. 94-171), table P1, block groups, Madison County ID',
                         'url': 'https://api.census.gov/data/2020/dec/pl', 'fetched': FETCHED, 'type': 'real'}, {'rows': rows})
print('P1 2020', len(rows) - 1, 'block groups')

TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/10/query'
q = urllib.parse.urlencode({'where': "STATE='16' AND COUNTY='065'", 'outFields': 'GEOID,TRACT,BLKGRP,AREALAND,AREAWATER', 'outSR': '4326', 'f': 'geojson'})
gj = get(TIGER + '?' + q)
save('bg_shapes.json', {'source': 'U.S. Census Bureau TIGERweb, ACS 2024 vintage, Census Block Groups, Madison County ID',
                        'url': TIGER.rsplit('/', 1)[0], 'fetched': FETCHED, 'type': 'real'}, {'type': 'FeatureCollection', 'features': gj['features']})
print('shapes', len(gj['features']), 'block groups')
