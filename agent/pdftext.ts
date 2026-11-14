/* Text layer of a PDF (the city's Laserfiche PDFs carry OCR text), so quotes the agent returns can be checked against
   the record itself. A scanned PDF with no text layer gives '' and its quotes show as "not checked". Node only. */
import { extractText, getDocumentProxy } from 'unpdf';

export async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true });
    return text;
  } catch { return ''; }
}

/* "Planning and Zoning Minutes – July 16, 2026" -> "P&Z minutes, July 16 2026": the record's own heading names it */
export function guessLabel(text: string): string {
  const m = text.slice(0, 4000).match(/(Planning (?:and|&) Zoning|P&Z|City Council)\s+(Minutes|Agenda)\s*[–—-]?\s*([A-Z][a-z]+ \d{1,2}),?\s+(\d{4})/);
  return m ? (/council/i.test(m[1]) ? 'City Council ' : 'P&Z ') + m[2].toLowerCase() + ', ' + m[3] + ' ' + m[4] : '';
}

/* A Laserfiche viewer link (what people copy from the city's archive) -> the PDF download for the same record */
export function laserficheFile(url: string): { file: string; page: string } | null {
  const m = url.match(/^https:\/\/laserfiche\.rexburg\.org\/WebLink\/(?:DocView\.aspx\?id=|ElectronicFile\.aspx\?docid=|doc\/)(\d+)/i);
  if (!m) return null;
  const base = 'https://laserfiche.rexburg.org/WebLink/';
  return { file: base + 'ElectronicFile.aspx?docid=' + m[1] + '&dbid=0&repo=Rexburg', page: base + 'DocView.aspx?id=' + m[1] + '&dbid=0&repo=Rexburg' };
}
