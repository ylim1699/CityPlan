/* Reviewing agent findings: quotes checked against the saved minutes, duplicates merged, buildings told apart,
   and street-grid addresses turned into map spots. Runs on the real candidates and city files (no API calls). */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadAtlas, readJson } from './load';
import { candidateId } from '../src/model/candidates';
import { categoryOf, checkQuote, groupFound, sameProject, screenOf, type Found } from '../src/model/review';
import { createGeocoder, gridOf } from '../src/model/geocode';
import { guessLabel, laserficheFile } from '../agent/pdftext';

const minutes = (f: string) => readFileSync(join(ROOT, 'data/raw/minutes', f), 'utf8');
const cands: Found[] = readJson('public/data/projects.candidates.json').candidates;

describe('quote check', () => {
  const pz = minutes('pz-2026-07-16.txt');
  it('finds a quote word for word', () => {
    expect(checkQuote('Planning and Zoning Administrator Parkinson also reported that the Summerfield development would be submitting its 14th plat for review.', pz)).toBe('exact');
  });
  it('accepts scan errors in the record ("5`h W", "HDRl")', () => {
    const cc = minutes('cc-2026-07-01.txt');
    expect(checkQuote('Council Member Riggins moved to approve Ordinance No 1349 Rezone 509-539 S 5th W from High Density Residential 1 (HDR1) to High Density Residential 2 (HDR2) Zone and consider second read', cc)).toBe('close');
  });
  it('rejects a quote that is not in the record', () => {
    expect(checkQuote('Council approved 400 student apartments at 300 S 2nd W with construction starting in spring.', pz)).toBe('missing');
  });
  it('checks each part of a quote joined with "..."', () => {
    expect(checkQuote('Planning and Zoning Administrator Parkinson also reported ... the Summerfield development would be submitting its 14th plat', pz)).toBe('exact');
    expect(checkQuote('Planning and Zoning Administrator Parkinson also reported ... the council approved a new stadium downtown', pz)).toBe('missing');
  });
  it('says "unchecked" when the record has no text', () => { expect(checkQuote('anything at all here', '')).toBe('unchecked'); });
  it('every saved candidate quote is in its record', () => {
    const byUrl = new Map(readdirSync(join(ROOT, 'data/raw/minutes')).map(f => { const t = minutes(f); return [(t.match(/^Source: (\S+)/) || [])[1], t]; }));
    const missing = cands.filter(c => checkQuote(c.quote, byUrl.get(c.foundIn.url) || '') === 'missing').map(c => c.name);
    expect(missing).toEqual(['Basic American Annexation']);  // stitched from an agenda list, flagged on purpose
  });
});

describe('category', () => {
  const cat = (name: string) => categoryOf(cands.find(c => c.name === name)!);
  it('keeps roads, utilities, rezonings and studies apart from buildings', () => {
    expect(cat('Walmart Wireless Communication Cell Tower')).toBe('utility');
    expect(cat('9th East Bridge Project')).toBe('road or trail');
    expect(cat('Rezone at 4 W Moody Rd')).toBe('zoning only');
    expect(cat('Comprehensive Plan Map Amendment at 4 W Moody Rd')).toBe('zoning only');
    expect(cat('Moody Townhomes PUD')).toBe('housing');
    expect(cat('Home Depot Subdivision')).toBe('subdivision');
  });
});

describe('same project in several records', () => {
  const groups = groupFound(cands, candidateId);
  const find = (name: string) => groups.find(g => g.members.some(m => m.name === name))!;
  it('merges Summerfield 14 from three records, led by the approval', () => {
    const g = find('Summerfield 14 Plat');
    expect(g.members).toHaveLength(3);
    expect(g.c.status).toBe('approved');
    expect(g.c.units).toBe(35); expect(g.c.acres).toBe(13.17);
  });
  it('merges Moody Townhomes and keeps the 137 lots', () => {
    const g = find('Moody Townhomes PUD');
    expect(g.members).toHaveLength(2); expect(g.c.units).toBe(137);
  });
  it('flags Home Depot records that disagree on the address', () => {
    const g = find('Home Depot Subdivision');
    expect(g.members).toHaveLength(2);
    expect(g.conflicts[0]).toMatch(/1600 N 2nd E/);
  });
  it('does not merge different projects at different sites', () => {
    expect(find('University Towne Center Plat').members).toHaveLength(1);
    expect(sameProject({ name: 'Moody Townhomes PUD', where: '396 W Moody Rd' }, { name: 'Rezone at 4 W Moody Rd', where: '4 W Moody Rd' })).toBe(false);
  });
  it('a plan amendment and the rezone of the same site are one item', () => {
    expect(find('Rezone at 4 W Moody Rd').members).toHaveLength(2);
  });
  it('a "Not mapped" note matches the project that answers it', () => {
    expect(sameProject({ name: 'The Home Depot', where: '' }, { name: 'Home Depot Subdivision', where: '' })).toBe(true);
  });
});

describe('street-grid map spots', () => {
  const A = loadAtlas(), G = createGeocoder(A);
  const ll = (w: string) => A.toLL(G.locate(w)!.pos);
  const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 111.2, (a[1] - b[1]) * 80.3);
  it('reads city and county street names', () => {
    expect(gridOf('North 2nd East')).toEqual({ axis: 'x', v: 200, scale: 'city' });
    expect(gridOf('West 1600 North')).toEqual({ axis: 'y', v: 1600, scale: 'county' });
    expect(gridOf('West Fourth North Street')).toEqual({ axis: 'y', v: 400, scale: 'city' });
    expect(gridOf('South Yellowstone Highway')).toBeNull();
  });
  it('puts 1450 N 2nd E (the Walmart cell tower) at the Walmart site', () => {
    const walmart = A.toLL(A.M(A.OSM.places.walmart));
    expect(km(ll('Approximately 1450 N 2nd East'), walmart)).toBeLessThan(0.6);
  });
  it('puts 1600 N 2nd E (Home Depot) near the temple, as the minutes say', () => {
    expect(km(ll('1600 N 2nd E'), A.toLL(A.PROJECTS.find(p => p.id === 'temple')!.pos!))).toBeLessThan(1);
  });
  it('gives no spot for an address without a grid direction', () => {
    expect(G.locate('601 University Blvd')).toBeNull();
    expect(G.locate('Wastewater Treatment Plant')).toBeNull();
  });
});

describe('records from the city archive', () => {
  it('turns a Laserfiche viewer link into the PDF download', () => {
    expect(laserficheFile('https://laserfiche.rexburg.org/WebLink/DocView.aspx?id=707665&dbid=0&repo=Rexburg')!.file).toBe('https://laserfiche.rexburg.org/WebLink/ElectronicFile.aspx?docid=707665&dbid=0&repo=Rexburg');
    expect(laserficheFile('https://example.com/DocView.aspx?id=1')).toBeNull();
  });
  it('names a record from its heading', () => {
    expect(guessLabel(minutes('pz-2026-07-16.txt'))).toBe('P&Z minutes, July 16 2026');
  });
});

describe('worth reviewing', () => {
  const c = (o: Partial<Found>): Found => ({ name: 'X', type: 'Apartments', status: 'approved', where: '300 S 2nd W', units: null, beds: null, sqft: null, acres: null,
    startYear: null, endYear: null, plain: '', quote: '', page: null, confidence: 'medium', flags: [], foundIn: { label: 'r', url: '' }, ...o });
  it('keeps new buildings, roads and rezonings', () => {
    expect(screenOf(c({ name: 'Test Flats' }))).toBeNull();
    expect(screenOf(c({ name: '7th S widening', type: 'Road work' }))).toBeNull();
    expect(screenOf(c({ name: 'Rezone 509 S 5th W', type: 'Rezone' }))).toBeNull();
  });
  it("follows the agent's verdict", () => {
    expect(screenOf(c({ worth: false, why: 'Vote to name the library' }))).toBe('Vote to name the library');
    expect(screenOf(c({ stage: 'already built', worth: true }))).toMatch(/built/i);
    expect(screenOf(c({ name: 'Bond for a new school', worth: true }))).toBeNull();
  });
  it('screens older candidates by their words', () => {
    expect(screenOf(c({ name: 'Library naming', type: 'Public building' }))).toMatch(/vote/);
    expect(screenOf(c({ name: 'Main St Diner remodel', type: 'Commercial' }))).toMatch(/already built/);
    expect(screenOf(c({ name: 'Sewer master plan', type: 'Study' }))).not.toBeNull();
  });
  it('keeps work under way, marked', () => {
    const g = groupFound([c({ name: 'Test Flats', stage: 'under construction' })], candidateId)[0];
    expect(g.screened).toBeNull(); expect(g.underway).toBe(true);
  });
});
