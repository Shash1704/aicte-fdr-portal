import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, FileCheck2, FlaskConical, LoaderCircle, RefreshCw, ScanText, Upload } from 'lucide-react';
import { api, getToken, DEMO, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/context';
import { fmtDate, inr, inrShort } from '../lib/format';
import type { InstrumentDetail } from '../lib/types';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, ToneBadge } from '../components/ui';

type Fields = Record<string, string>;
interface Read { source: string; fields: Record<string, unknown>; confidence: Record<string, number> }
const FIELD_KEYS = ['type', 'bank_code', 'branch', 'ifsc', 'instrument_no', 'amount', 'issue_date', 'maturity_date', 'depositor_name', 'lien_in_favour', 'interest_rate', 'auto_renew', 'account_no'];
const EMPTY: Fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, ''])) as Fields;

async function fetchBlob(path: string) {
  const res = DEMO ? await (await import('../demo/server.js')).demoFetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } }) : await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error('Could not load the sample');
  return res.blob();
}

/** Reads text from an image in the browser (tesseract.js), so scans need no server-side OCR. */
async function ocrImage(file: File, onProgress: (p: number) => void) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress(m.progress); } });
  try { return (await worker.recognize(file)).data.text; } finally { await worker.terminate(); }
}

export default function Submit() {
  const { user } = useAuth();
  const { meta, purposeName, bankName } = useLookups();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const renewId = sp.get('renew');
  const staff = user?.role !== 'institution';

  const { data: pred } = useQuery({ queryKey: ['instrument', renewId], enabled: !!renewId, queryFn: () => api<InstrumentDetail>(`/instruments/${renewId}`) });
  const [instId, setInstId] = useState<number | null>(user?.institution_id ?? null);
  const [instName, setInstName] = useState(user?.institution?.name ?? '');
  useEffect(() => { if (pred) { setInstId(pred.institution_id); setInstName(pred.institution_name); } }, [pred]);
  const [purpose, setPurpose] = useState('NEW_INST');
  const effPurpose = pred?.purpose ?? purpose;

  const [f, setF] = useState<Fields>(EMPTY);
  const [read, setRead] = useState<Read | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, File | null>>({ INSTRUMENT: null, COVER_LETTER: null, RESOLUTION: null, BANK_CONFIRMATION: null });
  const [ocrText, setOcrText] = useState('');
  const [readError, setReadError] = useState<string | null>(null);
  const [sampleKey, setSampleKey] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  const instType = user?.institution?.type ?? pred?.institution?.type ?? null;
  const { data: instInfo } = useQuery({ queryKey: ['institution-lite', instId], enabled: !!instId && staff, queryFn: () => api<{ type: string; name: string }>(`/institutions/${instId}`) });
  const type = instType ?? instInfo?.type ?? 'Engineering';
  const req = meta?.requirements.find((r) => r.purpose === effPurpose && r.inst_type === type);
  const required = pred?.required_amount ?? req?.min_amount;

  /** Reads the uploaded instrument and fills the form from it. */
  async function readDocument(file: File) {
    setReadError(null);
    setRead(null);
    try {
      let text = '';
      if (file.type.startsWith('image/')) {
        setReading('Reading the scan with OCR… 0%');
        text = await ocrImage(file, (p) => setReading(`Reading the scan with OCR… ${Math.round(p * 100)}%`));
        setOcrText(text);
      }
      setReading('Finding the instrument details…');
      const form = new FormData();
      form.append('file', file);
      if (text) form.append('ocr_text', text);
      const r = await api<Read>('/extract', { method: 'POST', form });
      setRead(r);
      if (!Object.keys(r.fields).length) setReadError('No details could be read from this document. Please type them in.');
      setF((cur) => {
        const next = { ...cur };
        for (const [k, v] of Object.entries(r.fields)) if (FIELD_KEYS.includes(k) && v !== null && v !== undefined) next[k] = String(v);
        return next;
      });
    } catch (e) {
      setReadError(`Automatic reading failed (${(e as Error).message}). Please type the details in.`);
    } finally { setReading(null); }
  }

  const pickFile = (kind: string, file: File | null) => {
    setFiles((x) => ({ ...x, [kind]: file }));
    if (kind === 'INSTRUMENT' && file) { setOcrText(''); readDocument(file); }
  };

  const { data: samples } = useQuery({
    queryKey: ['samples', instId, effPurpose], enabled: !!instId,
    queryFn: () => api<Array<{ key: string; title: string; expect: string; bank_name: string }>>(`/samples${qs({ institution_id: staff ? instId : undefined, purpose: effPurpose })}`),
  });
  const loadSample = async (key: string) => {
    setSampleKey(key);
    const base = `/samples/${key}`;
    const q = qs({ institution_id: staff ? instId : undefined, purpose: effPurpose });
    const [scan, cover, res] = await Promise.all(['instrument', 'cover', 'resolution'].map((d) => fetchBlob(`${base}/${d}${q}`)));
    const asFile = (b: Blob, name: string) => new File([b], name, { type: 'application/pdf' });
    const next: Record<string, File | null> = { INSTRUMENT: asFile(scan, `sample-${key}-fdr.pdf`), COVER_LETTER: asFile(cover, 'covering-letter.pdf'), RESOLUTION: asFile(res, 'board-resolution.pdf'), BANK_CONFIRMATION: null };
    if (key === 'letter') next.BANK_CONFIRMATION = asFile(await fetchBlob(`${base}/bank${q}`), 'bank-confirmation.pdf');
    setFiles(next);
    setF(EMPTY);
    await readDocument(next.INSTRUMENT!);
  };

  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (staff && instId) form.append('institution_id', String(instId));
      form.append('purpose', effPurpose);
      if (renewId) form.append('predecessor_id', renewId);
      for (const k of FIELD_KEYS) if (f[k] !== '') form.append(k, f[k]);
      if (ocrText) form.append('ocr_text', ocrText);
      for (const [kind, file] of Object.entries(files)) if (file) form.append(kind, file);
      return api<{ id: number }>('/instruments', { method: 'POST', form });
    },
    onSuccess: (r) => { qc.invalidateQueries(); nav(`/instruments/${r.id}`); },
  });

  const hasMaturity = f.type !== 'SD';
  const conf = read?.confidence ?? {};
  const hints = useMemo(() => {
    const h: Array<{ tone: 'warning' | 'critical'; text: string }> = [];
    if (f.lien_in_favour && !/aicte|all india council/i.test(f.lien_in_favour)) h.push({ tone: 'critical', text: 'The instrument must be in favour of AICTE (Member Secretary, AICTE).' });
    if (required && f.amount && Number(f.amount) < required) h.push({ tone: 'critical', text: `Amount is below the required ${inr(required)}.` });
    if (req && f.type && !req.accepted_types.split(',').includes(f.type)) h.push({ tone: 'critical', text: `${f.type} is not accepted for this purpose (${req.accepted_types}).` });
    if (f.bank_code && meta && !meta.banks.find((b) => b.code === f.bank_code)?.api && f.type !== 'SD' && !files.BANK_CONFIRMATION) h.push({ tone: 'warning', text: `${bankName(f.bank_code)} cannot be checked online; attach the bank's confirmation letter to avoid a query.` });
    return h;
  }, [f, required, req, meta, files.BANK_CONFIRMATION, bankName]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader crumbs={[{ label: staff ? 'Register' : 'My deposits', to: '/instruments' }, { label: renewId ? 'Renewal' : 'New submission' }]}
        title={renewId ? 'Submit renewal' : staff ? 'Record a deposit' : 'Submit a security deposit / FDR'}
        subtitle="Upload the instrument first: its details are read automatically and checked with the bank when you submit" />

      {pred && (
        <Card className="mb-4" bodyClass="p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <RefreshCw className="size-4 text-ink-3" />
            Renewing <Link to={`/instruments/${pred.id}`} className="font-medium text-accent-text hover:underline">{pred.ref_no}</Link>
            <span className="text-ink-3">{pred.type} {pred.instrument_no} · {inrShort(pred.amount)} · matures {fmtDate(pred.maturity_date)} · hold until {fmtDate(pred.hold_until)}</span>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card title="1 · Institution and purpose">
            <div className="grid gap-4 sm:grid-cols-2">
              {staff && !pred ? <InstitutionPicker value={instName} onPick={(id, name) => { setInstId(id); setInstName(name); }} /> : <Field label="Institution"><div className="py-2 text-sm">{instName}</div></Field>}
              <Field label="Purpose of deposit">
                {pred ? <div className="py-2 text-sm">{purposeName(pred.purpose)}</div> : (
                  <Select value={purpose} onChange={(e) => setPurpose(e.target.value)}>{meta?.purposes.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select>
                )}
              </Field>
            </div>
            {req && <p className="mt-3 text-xs text-ink-3">Requirement for {type}: at least {inr(required ?? req.min_amount)} as {req.accepted_types.split(',').join(' / ')}, minimum tenure {req.min_tenure_months} months, held for {req.hold_years} years{pred ? ` (until ${fmtDate(pred.hold_until)})` : ''}.</p>}
          </Card>

          <Card title="2 · Upload the instrument" subtitle="PDF e-advice or a scan (PNG/JPEG). Scans are read by OCR in your browser.">
            <FileDrop kind="INSTRUMENT" label="Scanned FDR / bank guarantee / payment receipt" file={files.INSTRUMENT} onPick={pickFile} required />
            {reading && <p className="mt-3 flex items-center gap-2 text-sm text-ink-2"><LoaderCircle className="size-4 animate-spin" />{reading}</p>}
            {read && !reading && Object.keys(read.fields).length > 0 && (
              <p className="mt-3 flex items-center gap-2 text-sm text-good-text"><ScanText className="size-4" />{Object.keys(read.fields).length} details read from the document ({read.source === 'ocr' ? 'OCR' : 'PDF text'}). Check them below.</p>
            )}
            {readError && <p className="mt-3 flex items-center gap-2 text-sm text-warning-text"><AlertTriangle className="size-4" />{readError}</p>}
          </Card>

          <Card title="3 · Confirm the details" subtitle="Fields read from the document are marked; you can correct anything">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
              <Field label="Instrument type" required>
                <Select value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">Choose…</option>{meta?.types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</Select>
              </Field>
              {f.type !== 'SD' ? (
                <Field label="Issuing bank" required hint={<Read c={conf.bank_code} />}>
                  <Select value={f.bank_code} onChange={(e) => set('bank_code', e.target.value)}><option value="">Choose…</option>{meta?.banks.map((b) => <option key={b.code} value={b.code}>{b.name}{b.api ? '' : ' (letter needed)'}</option>)}</Select>
                </Field>
              ) : <div />}
              <F k="instrument_no" label={f.type === 'SD' ? 'UTR / transaction number' : f.type === 'BG' ? 'Guarantee number' : 'FDR number'} f={f} set={set} conf={conf} required />
              <F k="amount" label="Amount (₹)" type="number" f={f} set={set} conf={conf} required hint={f.amount ? inr(Number(f.amount)) : undefined} />
              <F k="issue_date" label={f.type === 'SD' ? 'Date of transfer' : 'Date of issue / deposit'} type="date" f={f} set={set} conf={conf} required />
              {hasMaturity && <F k="maturity_date" label={f.type === 'BG' ? 'Valid up to' : 'Maturity date'} type="date" f={f} set={set} conf={conf} required />}
              {f.type !== 'SD' && <F k="branch" label="Branch" f={f} set={set} conf={conf} />}
              {f.type !== 'SD' && <F k="ifsc" label="IFSC" f={f} set={set} conf={conf} />}
              <F k="depositor_name" label="Depositor (Trust / Society)" f={f} set={set} conf={conf} required />
              <F k="lien_in_favour" label="Lien / in favour of" f={f} set={set} conf={conf} required />
              {f.type === 'FDR' && <F k="interest_rate" label="Interest rate (% p.a.)" type="number" f={f} set={set} conf={conf} />}
              {f.type === 'FDR' && <F k="account_no" label="Deposit account number" f={f} set={set} conf={conf} hint="Stored encrypted; shown masked" />}
              {f.type === 'FDR' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.auto_renew === '1'} onChange={(e) => set('auto_renew', e.target.checked ? '1' : '0')} />Auto-renewal instruction given to the bank</label>}
            </div>
            {!!hints.length && (
              <ul className="mt-4 space-y-1.5">
                {hints.map((h) => <li key={h.text} className={clsx('flex items-start gap-2 text-sm', h.tone === 'critical' ? 'text-critical-text' : 'text-warning-text')}><AlertTriangle className="mt-0.5 size-4 shrink-0" />{h.text}</li>)}
              </ul>
            )}
          </Card>

          <Card title="4 · Supporting documents">
            <div className="grid gap-3 sm:grid-cols-2">
              <FileDrop kind="COVER_LETTER" label="Covering letter" file={files.COVER_LETTER} onPick={pickFile} required />
              {f.type !== 'SD' && <FileDrop kind="RESOLUTION" label="Board resolution of the Trust / Society" file={files.RESOLUTION} onPick={pickFile} required />}
              {f.type !== 'SD' && <FileDrop kind="BANK_CONFIRMATION" label="Bank confirmation / lien letter (if the bank is not online)" file={files.BANK_CONFIRMATION} onPick={pickFile} />}
            </div>
          </Card>

          <ErrorBox error={submit.error} />
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-xs text-ink-3">On submission the portal checks the bank (where connected) and runs every discrepancy rule.</span>
            <Button variant="primary" className="h-11 px-8" loading={submit.isPending} disabled={!instId || !files.INSTRUMENT || !!reading} onClick={() => submit.mutate()}><FileCheck2 className="size-4" />Submit</Button>
          </div>
        </div>

        <aside className="min-w-0 space-y-4">
          <Card title="Try a sample FDR" subtitle="Demo only: realistic documents with a matching record in the bank sandbox">
            {!instId ? <p className="text-sm text-ink-3">Choose the institution first.</p> : (
              <ul className="space-y-2">
                {samples?.map((s) => (
                  <li key={s.key}>
                    <button onClick={() => loadSample(s.key).catch((e) => setReadError((e as Error).message))} disabled={!!reading}
                      className={clsx('w-full rounded-[8px] border p-3 text-left transition hover:border-ink', sampleKey === s.key ? 'border-ink bg-surface-1' : 'border-[var(--hairline)]')}>
                      <span className="flex items-center gap-2 text-sm font-medium"><FlaskConical className="size-4 shrink-0 text-ink-3" />{s.title}</span>
                      <span className="mt-1 block text-xs text-ink-3">{s.expect}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="What happens next">
            <ol className="space-y-2 text-sm text-ink-2">
              {['Fields are read from your document and compared with what you enter.', 'Connected banks confirm the deposit instantly; others need a confirmation letter.', 'The dealing officer scrutinises it (target: 7 days) and may raise a query.', 'Once accepted, the portal watches the maturity date and reminds you from 90 days before.'].map((t, i) => (
                <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ink-3" />{t}</li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Read({ c }: { c?: number }) {
  if (!c) return null;
  return <span className="inline-flex items-center gap-1 text-[11px] text-good-text"><ScanText className="size-3" />read from document{c < 0.8 ? ' (check)' : ''}</span>;
}

function F({ k, label, f, set, conf, type, required, hint }: { k: string; label: string; f: Fields; set: (k: string, v: string) => void; conf: Record<string, number>; type?: string; required?: boolean; hint?: string }) {
  return (
    <Field label={label} required={required} hint={<span className="flex flex-wrap gap-x-3">{conf[k] ? <Read c={conf[k]} /> : null}{hint && <span>{hint}</span>}</span>}>
      <Input type={type ?? 'text'} value={f[k]} onChange={(e) => set(k, e.target.value)} className={conf[k] ? 'border-good' : undefined} />
    </Field>
  );
}

function FileDrop({ kind, label, file, onPick, required }: { kind: string; label: string; file: File | null; onPick: (kind: string, f: File | null) => void; required?: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <label onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const fl = e.dataTransfer.files?.[0]; if (fl) onPick(kind, fl); }}
      className={clsx('flex cursor-pointer items-center gap-3 rounded-[8px] border border-dashed p-4 transition', over ? 'border-ink bg-surface-2' : 'border-[var(--axis)] hover:border-ink')}>
      {file ? <FileCheck2 className="size-5 shrink-0 text-good-text" /> : <Upload className="size-5 shrink-0 text-ink-3" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}{required && <span className="text-critical-text"> *</span>}</span>
        <span className="block truncate text-xs text-ink-3">{file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB` : 'Drop a file here or click to choose (PDF, PNG, JPEG)'}</span>
      </span>
      {file && <ToneBadge tone="good">Attached</ToneBadge>}
      <input type="file" className="sr-only" accept="application/pdf,image/png,image/jpeg" onChange={(e) => onPick(kind, e.target.files?.[0] ?? null)} />
    </label>
  );
}

function InstitutionPicker({ value, onPick }: { value: string; onPick: (id: number, name: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['inst-pick', q], enabled: q.length >= 2, queryFn: () => api<{ rows: Array<{ id: number; name: string; aicte_id: string; city: string }> }>(`/institutions${qs({ q, size: 8, sort: 'name' })}`) });
  return (
    <Field label="Institution" required>
      <div className="relative">
        <Input value={open ? q : value || q} placeholder="Search name or AICTE ID" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
        {open && data && (
          <div className="glass-pop absolute left-0 right-0 top-11 z-30 max-h-72 overflow-auto rounded-[8px] p-1">
            {data.rows.map((i) => (
              <button key={i.id} type="button" className="block w-full rounded-[6px] px-3 py-2 text-left hover:bg-surface-2" onClick={() => { onPick(i.id, i.name); setOpen(false); setQ(''); }}>
                <span className="block truncate text-sm">{i.name}</span><span className="text-xs text-ink-3">{i.aicte_id} · {i.city}</span>
              </button>
            ))}
            {!data.rows.length && <div className="px-3 py-2 text-sm text-ink-3">No match</div>}
          </div>
        )}
      </div>
    </Field>
  );
}
