// Reads instrument details out of an uploaded document.
// 1. pdfText(): the text layer of a digital PDF (bank e-advices, our generated documents).
//    Scanned images are read in the browser with OCR (tesseract.js) and the text is sent here.
// 2. parseFields(): finds the FDR/BG fields in that text with labelled patterns and scores confidence.
import { BANKS, bankByIfsc } from './domain.js';
import { inflate } from './inflate.js';

const latin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return s; };
const unescapePdf = (s) => s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => {
  if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
  return { n: '\n', r: '', t: ' ', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[c];
});

function contentText(content) {
  const out = [];
  let line = '';
  const re = /\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")|\[((?:\\.|[^\]])*)\]\s*TJ|\bT\*|\bTd\b|\bTD\b|\bET\b/g;
  let m;
  while ((m = re.exec(content))) {
    const tok = m[0];
    if (tok.startsWith('(')) line += unescapePdf(tok.slice(1, tok.lastIndexOf(')')));
    else if (tok.startsWith('[')) line += [...m[1].matchAll(/\((?:\\.|[^\\)])*\)/g)].map((x) => unescapePdf(x[0].slice(1, -1))).join('');
    else if (line) { out.push(line); line = ''; }
  }
  if (line) out.push(line);
  return out.join('\n');
}

/** Extracts the text layer from a PDF. Returns '' when there is none (e.g. a scanned image PDF). */
export function pdfText(bytes) {
  const raw = latin1(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const texts = [];
  const re = /<<([^]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    let data = raw.slice(start, end).replace(/\r?\n$/, '');
    if (/\/FlateDecode/.test(m[1])) {
      const buf = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) buf[i] = data.charCodeAt(i) & 0xff;
      const out = inflate(buf);
      if (!out) continue;
      data = latin1(out);
    } else if (/\/Filter/.test(m[1])) continue;
    if (/\bBT\b/.test(data)) texts.push(contentText(data));
    re.lastIndex = end;
  }
  return texts.join('\n').trim();
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Indian-style dates (dd-mm-yyyy, dd/mm/yy, 12 Mar 2027, 2027-03-12) → ISO yyyy-mm-dd. */
export function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3})[A-Za-z]*[\s,-]+(\d{4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}
function iso(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}
const DATE = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}[\s,-]+\d{4})`;
const SEP = String.raw`\s*(?:[:\-–]|is|of)?\s*`;

export const parseAmount = (s) => {
  if (s == null) return null;
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

// Each field: list of [regex, confidence]. The first matching pattern wins.
const PATTERNS = {
  instrument_no: [
    [new RegExp(String.raw`(?:FDR|F\.D\.R\.|TDR|STDR|Fixed\s+Deposit|Deposit\s+Receipt|Receipt|Guarantee|B\.?G\.?|UTR|Transaction)\s*(?:No\.?|Number|Ref(?:erence)?\.?\s*No\.?|#)${SEP}([A-Z0-9][A-Z0-9/-]{5,24})`, 'i'), 0.95],
  ],
  amount: [
    [/(?:Deposit\s+Amount|Principal(?:\s+Amount)?|Amount\s+of\s+(?:Deposit|Guarantee)|Guarantee\s+Amount|Amount\s+Deposited|Amount)\s*(?:\((?:Rs\.?|INR|₹)\))?\s*[:\-–]?\s*(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i, 0.95],
    [/(?:Rs\.?|INR|₹)\s*([\d,]{5,}(?:\.\d{1,2})?)/i, 0.6],
  ],
  issue_date: [
    [new RegExp(String.raw`(?:Date\s+of\s+(?:Deposit|Issue)|Deposit\s+Date|Issue\s+Date|Value\s+Date|Date\s+of\s+Transfer|Dated)${SEP}${DATE}`, 'i'), 0.95],
  ],
  maturity_date: [
    [new RegExp(String.raw`(?:Maturity\s+Date|Date\s+of\s+Maturity|Due\s+Date|Valid\s+(?:up\s*)?(?:to|till)|Validity|Expiry\s+Date|Date\s+of\s+Expiry)${SEP}${DATE}`, 'i'), 0.95],
  ],
  ifsc: [[/\b([A-Z]{4}0[A-Z0-9]{6})\b/, 0.95]],
  branch: [[/Branch\s*(?:Name)?\s*[:\-–]\s*([^\n]+?)(?:\s{2,}|\s+IFSC|$)/im, 0.8]],
  depositor_name: [[/(?:Name\s+of\s+(?:the\s+)?(?:Depositor|Applicant)|Depositor(?:'s)?\s+Name|Depositor|In\s+the\s+name\s+of|On\s+behalf\s+of|Remitter)\s*[:\-–]\s*([^\n]+)/i, 0.85]],
  lien_in_favour: [[/(?:Lien\s+(?:marked\s+)?(?:in\s+favour\s+of|to)|Pledged\s+(?:in\s+favour\s+of|to)|In\s+favour\s+of|Beneficiary)\s*[:\-–]?\s*([^\n]+)/i, 0.85]],
  interest_rate: [[/(?:Rate\s+of\s+Interest|Interest\s+Rate|ROI)\s*[:\-–]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%/i, 0.9]],
  account_no: [[/(?:A\/c|Account|Deposit\s+A\/c)\s*(?:No\.?|Number)?\s*[:\-–]?\s*(\d{9,18})\b/i, 0.85]],
};

/** Finds instrument fields in free text. Returns { fields, confidence, found, text }. */
export function parseFields(text) {
  const t = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const fields = {};
  const confidence = {};
  for (const [key, pats] of Object.entries(PATTERNS)) {
    for (const [re, conf] of pats) {
      const m = re.exec(t);
      if (!m) continue;
      let v = m[1].trim().replace(/[.,;]+$/, '');
      if (key === 'amount') v = parseAmount(v);
      else if (key === 'issue_date' || key === 'maturity_date') v = parseDate(v);
      else if (key === 'interest_rate') v = Number(v);
      else if (key === 'instrument_no') v = v.toUpperCase();
      if (v === null || v === '' || Number.isNaN(v)) continue;
      fields[key] = v;
      confidence[key] = conf;
      break;
    }
  }
  // Bank: from the IFSC prefix, else a bank name in the text.
  const byIfsc = fields.ifsc ? bankByIfsc(fields.ifsc) : null;
  const byName = BANKS.find((b) => new RegExp(`\\b${b.name.replace(/ /g, '\\s+')}\\b`, 'i').test(t));
  const bank = byIfsc || byName;
  if (bank) { fields.bank_code = bank.code; confidence.bank_code = byIfsc && byName && byIfsc.code === byName.code ? 0.99 : 0.8; }
  // Instrument type from wording.
  if (/bank\s+guarantee/i.test(t)) fields.type = 'BG';
  else if (/fixed\s+deposit|\bFDR\b|term\s+deposit/i.test(t)) fields.type = 'FDR';
  else if (/\bUTR\b|NEFT|RTGS|online\s+transfer|e-?receipt/i.test(t)) fields.type = 'SD';
  if (/auto[-\s]?renew/i.test(t)) fields.auto_renew = /not\s+auto[-\s]?renew|auto[-\s]?renew(?:al)?\s*[:\-]\s*no/i.test(t) ? 0 : 1;
  return { fields, confidence, found: Object.keys(fields).length, text: t.slice(0, 4000) };
}

/** Reads a document (PDF bytes) → parsed fields, or { source: 'none' } if it has no text layer. */
export function extractFromDocument(bytes, mime) {
  if (mime === 'application/pdf' || latin1(bytes.subarray(0, 5)) === '%PDF-') {
    const text = pdfText(bytes);
    if (text.length > 20) return { source: 'pdf-text', ...parseFields(text) };
  }
  return { source: 'none', fields: {}, confidence: {}, found: 0, text: '' };
}
