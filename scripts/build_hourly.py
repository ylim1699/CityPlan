"""Hourly traffic shape from ITD permanent counter 059 (SH-33, 5.3 mi east of Main St, Madison County).
Reads the two ITD PDF reports in data/raw/itd/ and writes public/data/hourly.json:
  weekday: share of a weekday's two-way traffic in each hour (Mon-Fri average, Nov 2023)
  saturday / sunday: the same for weekend days
  dayFactor: weekend day volume relative to an average weekday (2022 annual summary)
Usage: python -I scripts/build_hourly.py data/raw/itd public/data
Note: a highway counter outside town; it shows commute timing well, campus timing less so."""
import json, os, re, sys
import pypdf
SRC, OUT = sys.argv[1], sys.argv[2]
text = pypdf.PdfReader(os.path.join(SRC, 'itd059_nov23_hourly.pdf')).pages[0].extract_text()
rows = {}
for line in text.splitlines():
    m = re.match(r'^(\d\d):00 ((?:\d[\d,]* ?){21})$', line.strip())
    if m:
        v = [int(x.replace(',', '')) for x in m.group(2).split()]
        rows[int(m.group(1))] = v[0::3]   # the "Road" (both directions) column for SUN..SAT
assert len(rows) == 24, 'expected 24 hourly rows, got %d' % len(rows)
def shape(days):
    tot = [sum(rows[h][d] for d in days) for h in range(24)]; s = sum(tot)
    return [round(t / s, 4) for t in tot]
weekday, saturday, sunday = shape([1, 2, 3, 4, 5]), shape([6]), shape([0])
dow = pypdf.PdfReader(os.path.join(SRC, 'itd059_2022_dow.pdf')).pages[0].extract_text()
m = re.search(r'^2022 ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+)', dow, re.M)
sun, sat, aawdt = [int(m.group(i).replace(',', '')) for i in (1, 7, 9)]
out = {'meta': {'source': 'Idaho Transportation Department permanent counter 059 (SH-33, 5.3 mi E of Main St): Nov 2023 monthly average hourly report; 2022 annual day-of-week summary',
                'url': 'https://apps.itd.idaho.gov/apps/roadwaydata/059Newdale/', 'fetched': '2026-11-14', 'type': 'real'},
       'weekday': weekday, 'saturday': saturday, 'sunday': sunday,
       'dayFactor': {'weekday': 1, 'saturday': round(sat / aawdt, 3), 'sunday': round(sun / aawdt, 3)}}
json.dump(out, open(os.path.join(OUT, 'hourly.json'), 'w'))
print('weekday 8 am %.1f%%, noon %.1f%%, 5 pm %.1f%%; Saturday x%.2f, Sunday x%.2f' % (weekday[8] * 100, weekday[12] * 100, weekday[17] * 100, out['dayFactor']['saturday'], out['dayFactor']['sunday']))
