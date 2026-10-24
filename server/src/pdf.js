// Minimal single-page PDF writer with a real text layer (Helvetica). Used for the seeded instrument
// scans, sample FDRs and system-generated letters. Lines are strings or { text, size, bold, gap, rule }.
const enc = new TextEncoder();
const byteLen = (s) => enc.encode(s).length;
const esc = (s) => String(s).replace(/₹/g, 'Rs ').replace(/[^\x20-\x7e]/g, '-').replace(/([()\\])/g, '\\$1');

export function makePdf(lines, { border = false, stamp = null } = {}) {
  const ops = [];
  let y = 790;
  if (border) ops.push('0.6 w 0.25 0.25 0.3 RG 36 36 523 770 re S 0.3 w 42 42 511 758 re S');
  for (const raw of lines) {
    const l = typeof raw === 'string' ? { text: raw } : raw;
    const size = l.size ?? 11;
    y -= l.gap ?? Math.round(size * 1.35);
    if (l.rule) { ops.push(`0.4 w 0.5 0.5 0.55 RG 56 ${y + size / 2} m 539 ${y + size / 2} l S`); continue; }
    const x = l.center ? Math.max(56, 297 - (String(l.text).length * size * 0.26)) : (l.x ?? 56);
    ops.push(`BT /${l.bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${esc(l.text)}) Tj ET`);
  }
  if (stamp) ops.push(`BT /F2 9 Tf 0.45 0.45 0.5 rg 56 60 Td (${esc(stamp)}) Tj ET`);
  const body = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${byteLen(body)} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(byteLen(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = byteLen(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc.encode(out);
}
