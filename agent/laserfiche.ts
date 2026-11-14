/* Rexburg's public Laserfiche archive (WebLink 11): find the newest council and P&Z records and read their text.
   The portal is an app over JSON services (FolderListingService, DocumentService) that need a session cookie, and it
   allows only a few public sessions at once. So: one session at a time, always signed out after use, folder walks kept
   short, and results cached for a while, so checking for new records never crowds out residents using the archive.
   Node only (used by api/records.ts). */

const B = 'https://laserfiche.rexburg.org/WebLink/';
const REPO = 'Rexburg';

/* Where the records live (folder ids from the archive's own tree, checked November 2026):
   CITY CLERK > MINUTES > CITY COUNCIL MINUTES > <year> > "Council Minutes - October 21, 2026"
   PLANNING & ZONING > P&Z MINUTES > <year> > "10 October" > "P&Z Minutes 10.22.26.pdf"
   PLANNING & ZONING > P&Z AGENDAS > <year> > "11 November" > (agendas, posted before the meeting) */
export const SOURCES = [
  { kind: 'council', label: 'City Council minutes', root: 60274, months: false },
  { kind: 'pz', label: 'P&Z minutes', root: 67554, months: true },
  { kind: 'pz-agenda', label: 'P&Z agenda', root: 160486, months: true }
] as const;
export type Kind = typeof SOURCES[number]['kind'];
export type CityRecord = { id: number; kind: Kind; title: string; label: string; date: string; url: string; edoc: boolean };

type Entry = { name: string; entryId: number; type: number; extension: string; isEdoc: boolean; data: unknown[] };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export class ArchiveBusy extends Error {}

/* One signed-in visit to the archive. Always call close() (open() does it for you with use()). */
async function openSession() {
  const jar = new Map<string, string>();
  const take = (r: Response) => { (r.headers.getSetCookie?.() || []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); }); };
  const cookie = () => [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const get = async (path: string) => { const r = await fetch(B + path, { headers: { cookie: cookie() }, redirect: 'manual' }); take(r); return r; };
  /* the first visit sets the cookie and redirects once to confirm cookies work */
  await get('Browse.aspx?dbid=0&repo=' + REPO); await get('Browse.aspx?dbid=0&repo=' + REPO + '&cr=1');
  async function post<T>(service: string, body: unknown): Promise<T> {
    const r = await fetch(B + service, { method: 'POST', headers: { cookie: cookie(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    take(r);
    const t = await r.text();
    if (/number of sessions has reached the licensed limit/i.test(t)) throw new ArchiveBusy('The city archive is at its limit of public visitors right now. Try again in a few minutes.');
    try { const j = JSON.parse(t); return (j.data ?? j.d ?? j) as T; } catch { throw new Error('The city archive answered with something unexpected (HTTP ' + r.status + ')'); }
  }
  return {
    async list(folderId: number): Promise<Entry[]> {
      const d = await post<{ results: Entry[] }>('FolderListingService.aspx/GetFolderListing2',
        { repoName: REPO, folderId, getNewListing: true, start: 0, end: 300, sortColumn: '', sortAscending: true });
      return d.results || [];
    },
    async pageCount(id: number): Promise<number> {
      const d = await post<any>('DocumentService.aspx/GetBasicDocumentInfo', { repoName: REPO, entryId: id });
      return +(d?.pageCount ?? d?.PageCount ?? d?.numPages ?? 0) || 0;
    },
    async pageText(id: number, page: number): Promise<string> {
      const d = await post<any>('DocumentService.aspx/GetTextHtmlForPage', { repoName: REPO, documentId: id, pageNum: page, showAnn: false, searchUuid: '' });
      return htmlText(typeof d === 'string' ? d : d?.text ?? d?.html ?? '');
    },
    async file(id: number): Promise<Uint8Array> {
      const r = await get('ElectronicFile.aspx?docid=' + id + '&dbid=0&repo=' + REPO);
      return new Uint8Array(await r.arrayBuffer());
    },
    async close() { try { await get('Login.aspx?showLogin=yes&repo=' + REPO); } catch { /* the session times out on its own */ } }
  };
}
type Session = Awaited<ReturnType<typeof openSession>>;

/* One visit at a time from this server, kept open across the requests of one check (list, then each read) and signed out
   20 s after the last use, so a whole check takes a single public session. A visit refused for the limit is not kept. */
let queue: Promise<unknown> = Promise.resolve();
let open: { s: Session; timer: ReturnType<typeof setTimeout> | null } | null = null;
function use<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    if (open?.timer) clearTimeout(open.timer);
    if (!open) open = { s: await openSession(), timer: null };
    const cur = open;
    try { return await fn(cur.s); }
    catch (e) { if (e instanceof ArchiveBusy && open === cur) { open = null; await cur.s.close(); } throw e; }
    finally { if (open === cur) cur.timer = setTimeout(() => { if (open === cur) { open = null; cur.s.close(); } }, 20e3); }
  });
  queue = run.catch(() => {});
  return run;
}

function htmlText(h: string) {
  return h.replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+\n/g, '\n');
}

/* "Council Minutes - October 21, 2026", "P&Z Minutes 10.22.26.pdf", "11.05.26 P&Z Agenda"; else the date it was filed */
export function recordDate(name: string, created: unknown): string {
  const long = name.match(new RegExp('(' + MONTHS.join('|') + ')\\s+(\\d{1,2}),?\\s+(\\d{4})', 'i'));
  if (long) return iso(+long[3], MONTHS.findIndex(m => m.toLowerCase() === long[1].toLowerCase()) + 1, +long[2]);
  const num = name.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})\b/);
  if (num) return iso(+num[3] < 100 ? 2000 + +num[3] : +num[3], +num[1], +num[2]);
  const c = new Date(String(created || ''));
  return isNaN(+c) ? '' : c.toISOString().slice(0, 10);
}
const iso = (y: number, m: number, d: number) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
function nice(isoDate: string) { const [y, m, d] = isoDate.split('-').map(Number); return isoDate ? MONTHS[m - 1] + ' ' + d + ' ' + y : 'date not stated'; }

/* The newest records of each kind: this year's folder (and last year's early in the year), the last few month folders. */
async function walk(s: Session, now: Date): Promise<CityRecord[]> {
  const out: CityRecord[] = [], y = now.getFullYear(), m = now.getMonth() + 1;
  const years = m <= 2 ? [y, y - 1] : [y];
  for (const src of SOURCES) {
    const yearFolders = (await s.list(src.root)).filter(e => e.type === 0 && years.includes(+e.name.trim()));
    for (const yf of yearFolders) {
      let folders = [yf.entryId];
      if (src.months) {
        const want = [0, 1, 2].map(k => ((m - 1 - k + 12) % 12) + 1);
        folders = (await s.list(yf.entryId)).filter(e => e.type === 0 && want.includes(parseInt(e.name, 10))).map(e => e.entryId);
      }
      for (const f of folders) for (const e of await s.list(f)) {
        if (e.type === 0 || /no meeting|cancel+ed/i.test(e.name)) continue;  /* "P&Z Agenda - No Meeting": nothing to read */
        const date = recordDate(e.name, e.data?.[10]);
        out.push({ id: e.entryId, kind: src.kind, title: e.name.replace(/\.pdf$/i, ''), label: src.label + ', ' + nice(date), date,
          url: B + 'DocView.aspx?id=' + e.entryId + '&dbid=0&repo=' + REPO, edoc: !!e.isEdoc || /pdf/i.test(e.extension || '') });
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/* cached so a busy afternoon of "Check for new records" opens one archive session every ten minutes at most */
let listed: { at: number; records: CityRecord[] } | null = null;
export async function latestRecords(now = new Date()): Promise<CityRecord[]> {
  if (listed && Date.now() - listed.at < 10 * 60e3) return listed.records;
  const records = await use(s => walk(s, now));
  listed = { at: Date.now(), records };
  return records;
}

/* The record's text (scanned records carry OCR text page by page) or, for a PDF, the file itself */
const read = new Map<number, { pdf?: Uint8Array; text: string }>();
export async function recordContent(id: number, edoc: boolean): Promise<{ pdf?: Uint8Array; text: string }> {
  const hit = read.get(id); if (hit) return hit;
  /* the archive's "electronic file" flag does not match the file names, so try the likelier form first, then the other */
  const got = await use(async s => {
    const asFile = async () => { const b = await s.file(id); return b[0] === 0x25 && b[1] === 0x50 ? { pdf: b, text: '' } : null; };  // %P: a PDF
    const asText = async () => {
      const n = Math.min(await s.pageCount(id) || 1, 60), pages: string[] = [];
      for (let p = 1; p <= n; p++) pages.push(await s.pageText(id, p));
      const text = pages.join('\n\n'); return text.trim().length > 200 ? { text } : null;
    };
    return (edoc ? await asFile() || await asText() : await asText() || await asFile()) || { text: '' };
  });
  read.set(id, got);
  return got;
}
