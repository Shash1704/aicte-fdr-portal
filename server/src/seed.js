// Synthetic, realistic demo data. All institutions, people, banks' records and deposits are fictional.
// Portable: runs on Node (seed-cli.js, `npm run seed`) and in the browser (GitHub Pages demo).
//
// Each institution gets deposit "programmes" (one per approval that needed a deposit). Each programme is
// a chain of instruments renewed until the holding period ends, then released. Records before the
// portal's go-live date are marked legacy (migrated from the manual register) so the KPIs can compare
// manual handling with the portal. A few problems are planted on purpose for the demo.
import { initSchema, tx, addDays, addMonths, daysBetween, today, nowIso, setSetting } from './dbutil.js';
import { regionForState, REQUIREMENT_DEFAULTS, BANKS, bankByCode, DEFAULT_SETTINGS, typeByCode, purposeByCode, RELEASE_REASONS } from './domain.js';
import { Engine } from './engine.js';
import { makeAudit } from './audit.js';
import { instrumentPdf, coverLetterPdf, resolutionPdf, bankConfirmationPdf, releaseLetterPdf } from './letters.js';
import { extractFromDocument } from './extract.js';
import { sha256 } from './sha256.js';
import { normNo } from './bank.js';
import { encryptText } from './vault.js';

export const DEMO_PASSWORD = 'Aicte@2026';

// ---------- deterministic PRNG ----------
const DEFAULT_SEED = 20261024;
let _s = DEFAULT_SEED;
const rnd = () => { _s |= 0; _s = (_s + 0x6d2b79f5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const weighted = (pairs) => { const tot = pairs.reduce((s, [, w]) => s + w, 0); let r = rnd() * tot; for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[pairs.length - 1][0]; };
const lognormal = (mu, sigma) => { const u = 1 - rnd(), v = rnd(); return Math.exp(mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = (n) => String(n).padStart(2, '0');

// ---------- reference lists ----------
const CITIES = {
  'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Noida', 'Ghaziabad', 'Agra', 'Varanasi', 'Prayagraj', 'Meerut'],
  Uttarakhand: ['Dehradun', 'Haridwar', 'Roorkee'], Bihar: ['Patna', 'Gaya', 'Muzaffarpur'],
  Punjab: ['Mohali', 'Ludhiana', 'Jalandhar', 'Amritsar'], Haryana: ['Gurugram', 'Faridabad', 'Sonipat', 'Kurukshetra', 'Hisar'],
  'Himachal Pradesh': ['Shimla', 'Solan', 'Hamirpur'], Delhi: ['New Delhi'], Rajasthan: ['Jaipur', 'Jodhpur', 'Kota', 'Udaipur', 'Bikaner'],
  'Jammu and Kashmir': ['Jammu', 'Srinagar'],
  Maharashtra: ['Pune', 'Nagpur', 'Nashik', 'Aurangabad', 'Navi Mumbai', 'Kolhapur', 'Amravati'], Goa: ['Margao'],
  Gujarat: ['Ahmedabad', 'Vadodara', 'Surat', 'Rajkot', 'Gandhinagar'],
  'Madhya Pradesh': ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain'], Chhattisgarh: ['Raipur', 'Bhilai', 'Bilaspur'],
  'West Bengal': ['Kolkata', 'Durgapur', 'Siliguri', 'Howrah'], Odisha: ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur'],
  Jharkhand: ['Ranchi', 'Jamshedpur', 'Dhanbad'], Assam: ['Guwahati', 'Jorhat'],
  'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore'], Puducherry: ['Puducherry'],
  Karnataka: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Belagavi', 'Hubballi', 'Tumakuru'], Kerala: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam'],
  Telangana: ['Hyderabad', 'Warangal', 'Karimnagar', 'Khammam'], 'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Tirupati', 'Kakinada', 'Nellore'],
};
const STATE_WEIGHT = {
  'Tamil Nadu': 14, Maharashtra: 13, 'Andhra Pradesh': 11, Telangana: 9, 'Uttar Pradesh': 10, Karnataka: 8, Kerala: 5, 'Madhya Pradesh': 6,
  Rajasthan: 4, Gujarat: 5, Haryana: 4, Punjab: 4, 'West Bengal': 4, Odisha: 4, Chhattisgarh: 2, Jharkhand: 1.5, Bihar: 2, Uttarakhand: 1.5,
  'Himachal Pradesh': 1, Delhi: 1.5, 'Jammu and Kashmir': 1, Goa: 0.5, Assam: 1, Puducherry: 1,
};
const PREFIXES = ['Aryabhatta', 'Vidyaprabha', 'Jnanadeep', 'Shikshadeep', 'Gyanodaya', 'Sumedha', 'Prajnapeeth', 'Medhavi', 'Tejaswini', 'Kaushalya',
  'Navachetana', 'Sudarshan', 'Bhaskaracharya', 'Varahamihira', 'Sushruta', 'Panini', 'Kautilya', 'Gargi', 'Maitreyi', 'Lilavati', 'Ramanujan',
  'Brahmagupta', 'Dhruva', 'Abhyudaya', 'Pragati', 'Unnati', 'Prerana', 'Sankalp', 'Samarth', 'Shreyas', 'Utkarsh', 'Vardhaman', 'Adarsh',
  'Akshara', 'Amrutha', 'Anantha', 'Bhavitha', 'Chaitanya', 'Deepthi', 'Ekalavya', 'Harshavardhan', 'Jyothirmayi', 'Kamadhenu', 'Lakshya', 'Mahima',
  'Nalanda', 'Pratibha', 'Rishikul', 'Sahyadri', 'Tapovan', 'Udayagiri', 'Vaishnavi', 'Zenith', 'Matrubhumi', 'Kalpataru', 'Sanskriti',
  'Swarnabharathi', 'Vikasa', 'Suryodaya', 'Chandrakala', 'Dhanvantari', 'Satyabodh', 'Vivekdeep', 'Shubhodaya', 'Arunachala',
  'Mahendragiri', 'Sindhudurg', 'Vindhyachal', 'Aravalli', 'Nilachal', 'Kanchanjunga', 'Malaygiri', 'Saptagiri'];
const PATTERNS = [
  ['Engineering', 26, ['{P} Institute of Engineering & Technology', '{P} College of Engineering', '{P} Institute of Technology', '{P} Engineering College', '{P} Institute of Technology & Management']],
  ['Management', 6, ['{P} Institute of Management Studies', '{P} School of Business Management']],
  ['Pharmacy', 5, ['{P} College of Pharmacy', '{P} Institute of Pharmaceutical Sciences']],
  ['Polytechnic', 5, ['{P} Polytechnic', '{P} Polytechnic College']],
  ['Computer Applications', 2, ['{P} Institute of Computer Applications']],
  ['Architecture', 2, ['{P} School of Architecture']],
];
const TRUST_SUFFIX = ['Educational Trust', 'Education Society', 'Shikshan Prasarak Mandal', 'Vidya Samiti', 'Charitable Trust', 'Educational Foundation'];
const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Rohan', 'Karthik', 'Sai', 'Rahul', 'Aman', 'Nikhil', 'Pranav', 'Harsh', 'Vikram', 'Siddharth', 'Manoj', 'Suresh', 'Imran', 'Joseph', 'Gurpreet',
  'Ananya', 'Diya', 'Priya', 'Sneha', 'Kavya', 'Pooja', 'Meera', 'Lakshmi', 'Divya', 'Neha', 'Shreya', 'Fatima', 'Ayesha', 'Riya', 'Harini', 'Swathi', 'Nandini', 'Tanvi', 'Ishita', 'Mary'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Patel', 'Reddy', 'Naidu', 'Iyer', 'Nair', 'Menon', 'Kumar', 'Singh', 'Yadav', 'Das', 'Mohanty', 'Patil', 'Deshmukh', 'Kulkarni', 'Joshi', 'Khan',
  'Rao', 'Pillai', 'Chatterjee', 'Banerjee', 'Mishra', 'Tiwari', 'Pandey', 'Gowda', 'Hegde', 'Shetty', 'Bose', 'Sinha', 'Thomas', 'Fernandes', 'Kaur', 'Gill', 'Choudhary', 'Jain', 'Agarwal'];
const BRANCH_AREAS = ['Main Branch', 'Civil Lines', 'MG Road', 'Station Road', 'Industrial Estate', 'Cantonment', 'University Campus', 'Market Yard', 'Collectorate'];
const BANK_WEIGHT = { SBI: 30, PNB: 9, BOB: 9, CNB: 9, UBI: 7, HDFC: 6, ICICI: 5, AXIS: 4, IB: 7, BOI: 5, IOB: 4, UCO: 3, CBI: 3 };
const AICTE_LIEN = 'Member Secretary, AICTE, New Delhi';

export function seedDatabase(db, { hashPassword, store, log = () => {} }) {
  _s = DEFAULT_SEED;
  const t0 = Date.now();
  initSchema(db);
  const T = today();
  const NOW = nowIso();
  const GO_LIVE = addDays(T, -400);
  const ts = (d) => { const s = `${d}T${pad(ri(4, 11))}:${pad(ri(0, 59))}:${pad(ri(0, 59))}.000Z`; return s > NOW ? NOW : s; };
  const later = (stamp, minutes) => new Date(new Date(stamp).getTime() + minutes * 60000).toISOString();

  // ---------- reference data, users, institutions ----------
  const reqOf = {};
  tx(db, () => {
    setSetting(db, 'go_live', GO_LIVE);
    const insReq = db.prepare('INSERT INTO requirements (purpose, inst_type, min_amount, min_tenure_months, hold_years, accepted_types) VALUES (?,?,?,?,?,?)');
    for (const r of REQUIREMENT_DEFAULTS) {
      insReq.run(r.purpose, r.inst_type, r.min_amount, r.min_tenure_months, r.hold_years, r.accepted_types);
      reqOf[`${r.purpose}|${r.inst_type}`] = r;
    }
  });

  const institutions = [];
  const usedNames = new Set();
  tx(db, () => {
    const ins = db.prepare(`INSERT INTO institutions (aicte_id, name, type, ownership, trust_name, address, city, district, state, pincode, region_code, established, approval_status, email, phone, head_name, open_cases, dues_outstanding)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const usedIds = new Set();
    for (let k = 0; k < 320; k++) {
      const state = weighted(Object.entries(STATE_WEIGHT));
      const city = pick(CITIES[state]);
      const pat = weighted(PATTERNS.map((p) => [p, p[1]]));
      const type = pat[0];
      let name, prefix;
      do { prefix = pick(PREFIXES); name = pick(pat[2]).replace('{P}', prefix) + (chance(0.4) ? `, ${city}` : ''); } while (usedNames.has(name));
      usedNames.add(name);
      let aicte;
      do { aicte = `1-${ri(10000000, 49999999)}${ri(10, 99)}`; } while (usedIds.has(aicte));
      usedIds.add(aicte);
      const isNew = chance(0.38);
      const approvalDate = isNew ? addDays(T, -ri(40, 2700)) : null;
      const established = isNew ? Number(approvalDate.slice(0, 4)) : ri(1984, Number(T.slice(0, 4)) - 8);
      const ownership = weighted([['Private (self-financing)', 82], ['Government', 8], ['Government-aided', 6], ['Deemed / university', 4]]);
      const slug = (prefix.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10)) + type.slice(0, 3).toLowerCase() + ri(1, 99);
      const approval = isNew || chance(0.95) ? 'Approved' : weighted([['Closure approved', 3], ['Approval refused', 1], ['Application withdrawn', 1]]);
      const row = {
        aicte_id: aicte, name, type, ownership, trust_name: `${prefix} ${pick(TRUST_SUFFIX)}`, address: `${ri(1, 220)}, ${pick(['Ring Road', 'Highway Bypass', 'Education Hub', 'NH Service Road', 'Knowledge Park', 'Village Road'])}`,
        city, district: city, state, pincode: `${ri(110001, 855999)}`, region_code: regionForState(state), established, approval_status: approval,
        email: `principal@${slug}.edu.in`, phone: `+91 9${ri(100000000, 999999999)}`, head_name: `${pick(['Dr.', 'Prof.', 'Dr.'])} ${pick(FIRST)} ${pick(LAST)}`,
        open_cases: chance(0.12) ? ri(1, 3) : 0, dues_outstanding: chance(0.05) ? ri(2, 30) * 10000 : 0, isNew, approvalDate,
      };
      const r = ins.run(row.aicte_id, row.name, row.type, row.ownership, row.trust_name, row.address, row.city, row.district, row.state, row.pincode, row.region_code,
        row.established, row.approval_status, row.email, row.phone, row.head_name, row.open_cases, row.dues_outstanding);
      institutions.push({ ...row, id: Number(r.lastInsertRowid) });
    }
  });

  const pw = hashPassword(DEMO_PASSWORD);
  const officerRegions = [['NRO', 'NWRO'], ['WRO', 'CRO'], ['ERO', 'SCRO'], ['SRO', 'SWRO']];
  const staff = {};
  tx(db, () => {
    const ins = db.prepare('INSERT INTO users (username, name, designation, email, phone, role, institution_id, regions, password_hash) VALUES (?,?,?,?,?,?,?,?,?)');
    const add = (username, name, designation, role, regions = null, institution_id = null) => {
      const r = ins.run(username, name, designation, `${username.replace(/\./g, '')}@aicte-demo.in`, null, role, institution_id, regions, pw);
      staff[username] = { id: Number(r.lastInsertRowid), name, designation, role };
    };
    add('ms', 'Dr. Meera Kulkarni', 'Member Secretary (Competent Authority)', 'admin');
    add('rb.director', 'Shri Arvind Menon', 'Director, Regulation Bureau', 'head');
    officerRegions.forEach((regs, k) => add(`rb.officer${k + 1}`, `${pick(FIRST)} ${pick(LAST)}`, `Section Officer, RB (${regs.join(' & ')})`, 'officer', regs.join(',')));
    add('accounts', 'Shri Rakesh Bansal', 'Accounts Officer, Finance', 'accounts');
    add('auditor', 'Smt. Kavita Sinha', 'Internal Audit Officer', 'auditor');
  });
  const officerOf = (region) => staff[`rb.officer${officerRegions.findIndex((r) => r.includes(region)) + 1}`] ?? staff['rb.officer1'];

  // ---------- generate instrument chains in memory ----------
  const all = [];
  const usedNos = new Set();
  const newNo = (type, bank) => {
    let no;
    do {
      if (type === 'SD') no = `${bank ? bankByCode[bank].ifsc : 'SBIN'}R5${T.slice(0, 4)}${ri(10000000, 99999999)}`;
      else if (type === 'BG') no = `${ri(1000, 9999)}BG${ri(100000, 999999)}`;
      else no = { SBI: () => `${pick(['3', '4'])}${ri(1000000000, 9999999999)}`, PNB: () => `0${ri(100000000000000, 999999999999999)}`, HDFC: () => `5${ri(1000000000000, 9999999999999)}` }[bank]?.() ?? `${ri(1, 9)}${ri(100000000000, 999999999999)}`;
    } while (usedNos.has(no));
    usedNos.add(no);
    return no;
  };
  const turnaround = (legacy) => (legacy ? clamp(Math.round(lognormal(Math.log(32), 0.55)), 8, 160) : clamp(Math.round(lognormal(Math.log(2), 0.75)), 0, 18));
  const ifscFor = (bank) => `${bankByCode[bank].ifsc}0${String(ri(1, 999999)).padStart(6, '0')}`;

  function mkInstr(inst, prog, { type, bank, branch, ifsc, amount, issue, maturity, sub }) {
    return {
      inst, purpose: prog.purpose, type, bank_code: type === 'SD' ? null : bank, branch: type === 'SD' ? `${inst.city} (remitting branch)` : branch, ifsc: type === 'SD' ? null : ifsc,
      amount, issue_date: issue, maturity_date: typeByCode[type].hasMaturity ? maturity : null, sub, hold_until: prog.hold, required: prog.required,
      depositor: inst.trust_name, lien: type === 'SD' ? 'All India Council for Technical Education (AICTE)' : chance(0.3) ? `Jointly: ${AICTE_LIEN} and ${inst.trust_name}` : AICTE_LIEN,
      instrument_no: newNo(type, bank), rate: Math.round((6.4 + rnd() * 1.2) * 100) / 100, auto_renew: chance(0.3) ? 1 : 0,
      account: String(ri(10000000000, 99999999999)), legacy: sub < GO_LIVE ? 1 : 0, prog,
    };
  }

  function buildProgramme(inst, prog) {
    const req = reqOf[`${prog.purpose}|${inst.type}`];
    prog.hold = addMonths(prog.A, req.hold_years * 12);
    prog.required = req.min_amount;
    const accepted = req.accepted_types.split(',');
    const type = weighted(accepted.map((x) => [x, x === 'FDR' ? 75 : x === 'BG' ? 14 : 14]));
    let bank = weighted(Object.entries(BANK_WEIGHT));
    let branch = `${inst.city} ${pick(BRANCH_AREAS)}`;
    let ifsc = ifscFor(bank);
    const amount = chance(0.85) ? req.min_amount : Math.round((req.min_amount * (1 + ri(1, 5) / 10)) / 1000) * 1000;
    let issue = addDays(prog.A, -ri(12, 45));
    let sub = addDays(issue, ri(1, 8));
    if (prog.fresh) { sub = addDays(T, -ri(0, 16)); issue = addDays(sub, -ri(1, 6)); }
    if (type === 'SD') {
      const x = mkInstr(inst, prog, { type, bank, branch, ifsc, amount, issue, sub });
      all.push(x);
      return;
    }
    let prev = null;
    for (let guard = 0; guard < 12; guard++) {
      if (sub > T) break;
      const tenure = type === 'BG' ? pick([12, 24, 36]) : weighted([[12, 30], [24, 25], [36, 30], [60, 15]]);
      let maturity = addMonths(issue, tenure);
      // A last instrument usually runs to the end of the holding period.
      if (maturity < prog.hold && daysBetween(maturity, prog.hold) < 200) maturity = addDays(prog.hold, ri(0, 40));
      if (!chance(0.85) && guard) { bank = weighted(Object.entries(BANK_WEIGHT)); branch = `${inst.city} ${pick(BRANCH_AREAS)}`; ifsc = ifscFor(bank); }
      const x = mkInstr(inst, prog, { type, bank, branch, ifsc, amount, issue, maturity, sub });
      if (prev) { x.pred = prev; prev.succ = x; }
      all.push(x);
      if (maturity >= prog.hold) break;
      // renewal of x
      const legacyEra = maturity < GO_LIVE;
      const delta = legacyEra ? weighted([[ri(-25, -1), 40], [ri(0, 20), 32], [ri(21, 80), 28]]) : weighted([[ri(-45, -3), 70], [ri(-2, 10), 20], [ri(11, 28), 10]]);
      if (maturity < T && maturity > addDays(T, -200) && chance(0.2)) { x.forcedLapse = true; break; }
      sub = addDays(maturity, delta);
      issue = addDays(sub, -ri(1, 6));
      prev = x;
    }
  }

  for (const inst of institutions) {
    if (inst.isNew) buildProgramme(inst, { purpose: 'NEW_INST', A: inst.approvalDate });
    else if (chance(0.28)) buildProgramme(inst, { purpose: 'NEW_INST', A: addDays(T, -ri(1900, 3400)) });
    if (chance(0.33)) buildProgramme(inst, { purpose: 'INTAKE', A: addDays(T, -ri(20, 1500)) });
    if (chance(0.06)) buildProgramme(inst, { purpose: 'COLLAB', A: addDays(T, -ri(40, 1800)) });
    if (chance(0.08)) buildProgramme(inst, { purpose: 'CHANGE', A: addDays(T, -ri(40, 1300)) });
    if (chance(0.06)) buildProgramme(inst, { purpose: 'CONDITIONAL', A: addDays(T, -ri(20, 900)) });
  }
  // Fresh applications this month: deposits submitted ahead of approval, still under scrutiny.
  const freshInsts = institutions.filter((i) => !i.isNew).sort(() => rnd() - 0.5).slice(0, 26);
  for (const inst of freshInsts) buildProgramme(inst, { purpose: weighted([['NEW_INST', 2], ['INTAKE', 5], ['CHANGE', 2], ['CONDITIONAL', 2], ['COLLAB', 1]]), A: addDays(T, ri(10, 60)), fresh: true });

  // ---------- decide each instrument's fate ----------
  for (const x of all) {
    x.verified = x.prog.fresh && !x.pred ? null : addDays(x.sub, turnaround(x.legacy));
    if (x.verified && x.verified > T) x.verified = null;
    // some renewals submitted in the last fortnight are still being checked
    if (x.pred && x.verified && x.sub >= addDays(T, -12) && chance(0.5)) x.verified = null;
  }
  for (const x of all) {
    if (!x.verified) {
      const age = daysBetween(x.sub, T);
      x.status = age <= 1 ? 'Submitted' : age >= 3 && chance(0.4) ? 'Query Raised' : 'Under Scrutiny';
      continue;
    }
    const succVerified = x.succ?.verified;
    if (succVerified) { x.status = 'Renewed'; x.closed = succVerified; continue; }
    const renewalNeeded = x.maturity_date && x.maturity_date < x.hold_until;
    if (x.maturity_date && x.maturity_date < T) x.status = 'Matured';
    else x.status = 'Active';
    x.lapsed = renewalNeeded && x.status === 'Matured' && !x.succ;
  }

  // Release scenarios: completed holding periods and replaced instruments.
  const stageOrder = ['Submitted', 'Recommended', 'Forwarded', 'Approved', 'Released'];
  for (const x of all) {
    let reason = null;
    let earliest = null;
    if (['Active', 'Matured'].includes(x.status) && x.hold_until <= addDays(T, -3) && !x.lapsed) {
      const roll = rnd();
      if (roll < 0.55) reason = 'HOLD_COMPLETE'; else if (roll < 0.78) reason = 'HOLD_COMPLETE_RECENT';
      earliest = x.hold_until;
    } else if (x.status === 'Renewed' && x.closed <= addDays(T, -20)) {
      const roll = rnd();
      if (roll < 0.42) reason = 'REPLACED'; else if (roll < 0.5 && x.closed >= addDays(T, -90)) reason = 'REPLACED_RECENT';
      earliest = x.closed;
    } else if (['Active', 'Matured'].includes(x.status) && ['Closure approved', 'Approval refused', 'Application withdrawn'].includes(x.inst.approval_status) && chance(0.7)) {
      reason = x.inst.approval_status === 'Closure approved' ? 'CLOSURE' : 'NOT_APPROVED';
      earliest = addDays(T, -ri(10, 200));
    }
    if (!reason) continue;
    const recent = reason.endsWith('_RECENT');
    reason = reason.replace('_RECENT', '');
    const legacy = earliest < GO_LIVE;
    const slow = legacy ? 4 : 1;
    let req = recent ? addDays(T, -ri(0, 28)) : addDays(earliest, ri(5, 70));
    if (req > T) req = addDays(T, -ri(0, 10));
    if (req < earliest) req = earliest;
    const dates = [req];
    for (let k = 1; k < 5; k++) dates.push(addDays(dates[k - 1], ri(1, 5) * slow));
    const reached = dates.filter((d) => d <= T).length;
    x.release = { reason, dates: dates.slice(0, reached), stage: stageOrder[reached - 1], legacy };
    if (x.release.stage !== 'Released' && chance(0.08)) x.release.returned = true;
    x.prevStatus = x.status;
    if (x.release.stage === 'Released') { x.status = 'Released'; x.closed = dates[4]; } else x.status = 'Release Requested';
  }

  // Rejected submissions in the portal era: problems caught at scrutiny.
  const REJECT_KINDS = [['BANK_NOT_FOUND', 'The bank has no record of this FDR; the scan appears to be forged.'], ['BANK_MISMATCH', 'Amount on the scan differs from the bank\'s record (altered document).'],
    ['DUPLICATE_INSTRUMENT', 'The same FDR was already pledged for another institution.'], ['LIEN_NOT_AICTE', 'FDR was not lien-marked in favour of AICTE and was not corrected.'], ['AMOUNT_SHORT', 'Amount below the prescribed deposit.']];
  const rejected = [];
  for (const x of all.filter((y) => !y.legacy && !y.pred && y.verified && y.sub > addDays(GO_LIVE, 20)).sort(() => rnd() - 0.5).slice(0, 18)) {
    const [rule, why] = pick(REJECT_KINDS);
    const sub = addDays(x.sub, -ri(8, 25));
    const r = { ...x, pred: null, succ: null, release: null, sub, verified: null, status: 'Rejected', closed: addDays(sub, ri(2, 9)), rejectRule: rule, rejectWhy: why, instrument_no: newNo(x.type, x.bank_code) };
    if (rule === 'AMOUNT_SHORT') r.amount = Math.round(x.amount * 0.6);
    if (rule === 'LIEN_NOT_AICTE') r.lien = x.inst.trust_name;
    rejected.push(r);
  }
  all.push(...rejected);

  // Planted problems on submissions currently under scrutiny.
  const pending = all.filter((x) => ['Submitted', 'Under Scrutiny', 'Query Raised'].includes(x.status));
  const apiPending = pending.filter((x) => x.type !== 'SD' && bankByCode[x.bank_code]?.api);
  const plantList = [['tampered', 3], ['notfound', 2], ['nolien', 2], ['docmismatch', 3], ['short', 2], ['duplicate', 2], ['missingdoc', 4]];
  const pool = [...apiPending].sort(() => rnd() - 0.5);
  for (const [kind, n] of plantList) {
    for (let k = 0; k < n; k++) {
      const x = ['missingdoc', 'short', 'nolien', 'docmismatch'].includes(kind) ? pending.find((y) => !y.plant && (kind !== 'docmismatch' || y.maturity_date)) : pool.find((y) => !y.plant);
      if (!x) break;
      x.plant = kind;
      if (kind === 'short') x.amount = Math.round(x.required * 0.6 / 1000) * 1000;
      if (kind === 'nolien') x.lien = x.inst.trust_name;
      if (kind === 'duplicate') {
        const victim = all.find((y) => y.status === 'Active' && y.type === x.type && y.bank_code && y.inst.id !== x.inst.id && !y.victim);
        if (victim) { victim.victim = true; x.bank_code = victim.bank_code; x.ifsc = victim.ifsc; x.branch = victim.branch; x.instrument_no = victim.instrument_no; x.dupOf = victim; }
      }
    }
  }
  // Two accepted deposits that the bank later reports as encashed (caught by the periodic re-check).
  const encashed = all.filter((x) => x.status === 'Active' && !x.legacy && x.type === 'FDR' && bankByCode[x.bank_code]?.api && x.maturity_date > addDays(T, 120) && !x.victim).slice(3, 5);
  for (const x of encashed) x.encashed = true;

  // ---------- write to the database ----------
  all.sort((a, b) => (a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0));
  const refCount = {};
  const relCount = {};
  const events = db.prepare('INSERT INTO instrument_events (instrument_id, at, actor_id, type, from_status, to_status, remarks, data) VALUES (?,?,?,?,?,?,?,?)');
  const ev = (x, at, actor, type, remarks, { from = null, to = null, data = null } = {}) => events.run(x.id, at, actor?.id ?? null, type, from, to, remarks, data ? JSON.stringify(data) : null);
  const outbox = db.prepare('INSERT INTO outbox (at, channel, to_addr, institution_id, instrument_id, kind, subject, body) VALUES (?,?,?,?,?,?,?,?)');
  const mail = (x, at, kind, subject, body, channel = 'email') => outbox.run(at, channel, channel === 'sms' ? x.inst.phone : x.inst.email, x.inst.id, x.id, kind, subject, body);
  const docIns = db.prepare('INSERT INTO documents (instrument_id, release_id, kind, filename, stored_name, mime, size, sha256, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  let docSeq = 0;
  const saveDoc = (x, kind, filename, bytes, at, by = null, releaseId = null) => {
    const name = `seed-${x.id}-${++docSeq}.pdf`;
    store.save(name, bytes);
    docIns.run(x.id, releaseId, kind, filename, name, 'application/pdf', bytes.length, sha256(bytes), by?.id ?? null, at);
  };
  const reg = db.prepare(`INSERT INTO bank_registry (bank_code, instrument_no, branch, ifsc, amount, issue_date, maturity_date, depositor_name, lien_in_favour, status, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(bank_code, instrument_no) DO NOTHING`);
  const insInstr = db.prepare(`INSERT INTO instruments (ref_no, institution_id, purpose, type, status, instrument_no, bank_code, branch, ifsc, amount, issue_date, maturity_date,
      depositor_name, lien_in_favour, auto_renew, interest_rate, account_enc, account_masked, doc_json, doc_source, bank_json, bank_status, bank_checked_at, verification, verified_at, verified_by,
      required_amount, hold_until, predecessor_id, officer_id, submitted_at, submitted_by, activated_at, matured_on, closed_at, legacy, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const instUser = new Map();

  tx(db, () => {
    for (const x of all) {
      const year = x.sub.slice(0, 4);
      refCount[year] = (refCount[year] ?? 0) + 1;
      x.ref = `SD-${year}-${String(refCount[year]).padStart(5, '0')}`;
      x.subAt = ts(x.sub);
      x.officer = officerOf(x.inst.region_code);
      const verifier = x.verified ? (chance(0.85) ? x.officer : staff['rb.director']) : null;
      x.verifiedAt = x.verified ? (x.verified === x.sub ? later(x.subAt, ri(30, 300)) : ts(x.verified)) : null;
      if (x.verifiedAt && x.verifiedAt < x.subAt) x.verifiedAt = later(x.subAt, ri(30, 300));
      const api = x.type !== 'SD' && bankByCode[x.bank_code]?.api;
      x.mode = !x.verified ? 'unverified' : x.type === 'SD' ? 'bank_letter' : x.legacy ? (chance(0.7) ? 'officer' : 'bank_letter') : api ? 'bank_api' : 'bank_letter';
      // bank's own record
      if (x.type !== 'SD' && x.plant !== 'notfound' && !x.dupOf && !(x.rejectRule === 'BANK_NOT_FOUND')) {
        const bankAmount = x.plant === 'tampered' || x.rejectRule === 'BANK_MISMATCH' ? Math.round(x.amount / 10) : x.amount;
        const regStatus = x.encashed ? 'encashed' : x.status === 'Renewed' ? 'closed' : 'active';
        reg.run(x.bank_code, normNo(x.instrument_no), x.branch, x.ifsc, bankAmount, x.issue_date, x.maturity_date, x.depositor, x.status === 'Released' ? 'Lien released' : x.lien, regStatus, x.subAt);
      }
      // the document as printed (planted mismatch: the scan shows another maturity date)
      const printed = { type: x.type, bank_code: x.bank_code ?? 'SBI', branch: x.branch, ifsc: x.ifsc ?? '', instrument_no: x.instrument_no, amount: x.amount, issue_date: x.issue_date,
        maturity_date: x.plant === 'docmismatch' ? addMonths(x.maturity_date, -12) : x.maturity_date, depositor_name: x.depositor, lien_in_favour: x.lien, interest_rate: x.rate, auto_renew: x.auto_renew, account_no: x.account };
      x.pdf = instrumentPdf(printed);
      const doc = x.legacy ? { source: 'migrated', fields: {}, confidence: {} } : (() => { const r = extractFromDocument(x.pdf, 'application/pdf'); return { source: r.source, fields: r.fields, confidence: r.confidence }; })();
      // bank check result stored with the instrument
      let bankJson = null;
      let bankStatus = 'unchecked';
      let checkedAt = null;
      const heldNow = ['Active', 'Matured', 'Release Requested'].includes(x.status);
      if (api && (!x.legacy || heldNow)) {
        checkedAt = later(x.subAt, ri(1, 4));
        const rec = x.plant === 'notfound' || x.rejectRule === 'BANK_NOT_FOUND' ? null : {
          instrument_no: normNo(x.instrument_no), amount: x.plant === 'tampered' || x.rejectRule === 'BANK_MISMATCH' ? Math.round(x.amount / 10) : x.amount,
          issue_date: x.dupOf ? x.dupOf.issue_date : x.issue_date, maturity_date: x.dupOf ? x.dupOf.maturity_date : x.maturity_date, ifsc: x.ifsc, branch: x.branch,
          depositor_name: x.dupOf ? x.dupOf.depositor : x.depositor, lien_in_favour: x.dupOf ? x.dupOf.lien : x.lien, status: 'active',
        };
        bankStatus = !rec ? 'not_found' : rec.amount === x.amount && rec.issue_date === x.issue_date && rec.maturity_date === x.maturity_date ? 'confirmed' : 'mismatch';
        bankJson = JSON.stringify({ status: rec ? 'found' : 'not_found', bank: bankByCode[x.bank_code].name, record: rec, at: checkedAt, ref: `BVS-${sha256(x.ref).slice(0, 10).toUpperCase()}` });
        if (heldNow) {
          checkedAt = x.encashed ? `${addDays(T, -31)}T05:00:00.000Z` : `${addDays(T, -ri(0, 29))}T04:30:00.000Z`;
        }
      } else if (x.verified && x.mode !== 'officer') { bankStatus = 'confirmed'; checkedAt = x.verifiedAt; }
      const r = insInstr.run(x.ref, x.inst.id, x.purpose, x.type, x.status, normNo(x.instrument_no), x.bank_code, x.branch, x.ifsc, x.amount, x.issue_date, x.maturity_date,
        x.depositor, x.lien, x.auto_renew, x.rate, encryptText(x.account), `XXXX${x.account.slice(-4)}`, JSON.stringify(doc), doc.source, bankJson, bankStatus, checkedAt,
        x.mode, x.verifiedAt, verifier?.id ?? null, x.required, x.hold_until, x.pred?.id ?? null, x.officer.id, x.subAt, null, x.verifiedAt,
        x.status === 'Matured' || (x.maturity_date && x.maturity_date < T && x.status !== 'Rejected') ? x.maturity_date : null, x.closed ? ts(x.closed) : null, x.legacy, x.subAt, x.subAt);
      x.id = Number(r.lastInsertRowid);
      x.verifier = verifier;
    }
    // successor links
    const setSucc = db.prepare('UPDATE instruments SET successor_id = ? WHERE id = ?');
    for (const x of all) if (x.succ?.id) setSucc.run(x.succ.id, x.id);
  });

  // ---------- documents, events, notifications, queries, releases ----------
  const relIns = db.prepare(`INSERT INTO release_requests (req_no, instrument_id, institution_id, reason, details, status, prev_instrument_status, requested_by, requested_at, manual_checks,
      recommended_by, recommended_at, forwarded_by, forwarded_at, approved_by, approved_at, released_by, released_at, release_ref, closed_remarks, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const qIns = db.prepare('INSERT INTO queries (instrument_id, raised_by, raised_at, due_on, text, status, response, responded_at, responded_by) VALUES (?,?,?,?,?,?,?,?,?)');
  const discIns = db.prepare(`INSERT OR IGNORE INTO discrepancies (instrument_id, rule, field, severity, message, action, status, detected_at, resolved_at, resolved_by, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const ladder = DEFAULT_SETTINGS.reminder_ladder;
  const typeShort = (x) => typeByCode[x.type].short;
  const inr = (n) => `Rs ${Number(n).toLocaleString('en-IN')}`;
  const dmy = (d) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  const QUERY_TEXT = {
    tampered: 'The bank\'s record does not match the amount on the uploaded FDR. Please explain and get the bank to confirm the deposit in writing.',
    notfound: 'The issuing bank has no record of this FDR number. Please submit a confirmation letter from the branch manager.',
    nolien: 'The FDR is not lien-marked in favour of the Member Secretary, AICTE. Please get the lien marked and upload the revised FDR.',
    docmismatch: 'The maturity date entered in the form differs from the uploaded FDR. Please correct the form or upload the correct document.',
    short: 'The deposit is below the prescribed amount. Please submit an additional FDR for the shortfall.',
    duplicate: 'This FDR number is already pledged on record for another institution. Please explain.',
    missingdoc: 'The board resolution of the Trust/Society authorising the deposit has not been uploaded. Please upload it.',
  };

  let n = 0;
  tx(db, () => {
    for (const x of all) {
      n++;
      const held = ['Active', 'Matured', 'Release Requested', 'Submitted', 'Under Scrutiny', 'Query Raised'].includes(x.status);
      const name = `${typeShort(x)}-${x.instrument_no}.pdf`;
      saveDoc(x, 'INSTRUMENT', name, x.pdf, x.subAt);
      if (held) {
        saveDoc(x, 'COVER_LETTER', 'covering-letter.pdf', coverLetterPdf(x.inst, { ...x, depositor_name: x.depositor, lien_in_favour: x.lien }, purposeByCode[x.purpose].name.toLowerCase()), x.subAt);
        if (x.type !== 'SD' && x.plant !== 'missingdoc') saveDoc(x, 'RESOLUTION', 'board-resolution.pdf', resolutionPdf(x.inst, { ...x, lien_in_favour: x.lien }), x.subAt);
        if (x.mode === 'bank_letter' || (x.type !== 'SD' && !bankByCode[x.bank_code]?.api && x.status !== 'Submitted' && chance(0.6))) {
          saveDoc(x, 'BANK_CONFIRMATION', 'bank-confirmation.pdf', bankConfirmationPdf({ ...x, lien_in_favour: x.lien }), x.verifiedAt ? later(x.verifiedAt, -ri(60, 2000)) : x.subAt);
        }
      }
      x.pdf = null;

      ev(x, x.subAt, null, 'SUBMITTED', `${typeShort(x)} ${x.instrument_no} for ${inr(x.amount)}${x.pred ? ` as renewal of ${x.pred.ref}` : ''}.${x.legacy ? ' (Migrated from the manual register.)' : ''}`, { to: 'Submitted' });
      if (!x.legacy) {
        mail(x, x.subAt, 'ACK', `${x.ref}: ${typeShort(x)} received`, `We have received ${typeShort(x)} No. ${x.instrument_no} for ${inr(x.amount)}. Reference ${x.ref}.`);
        ev(x, later(x.subAt, 1), null, 'EXTRACTED', 'Fields read from the document (PDF text).');
        if (x.type !== 'SD' && bankByCode[x.bank_code]?.api) {
          const st = x.plant === 'notfound' || x.rejectRule === 'BANK_NOT_FOUND' ? 'not_found' : x.plant === 'tampered' || x.rejectRule === 'BANK_MISMATCH' || x.dupOf ? 'mismatch' : 'confirmed';
          ev(x, later(x.subAt, 2), null, 'BANK_CHECK', { confirmed: `${bankByCode[x.bank_code].name} confirmed all details.`, mismatch: `${bankByCode[x.bank_code].name} holds this deposit but some details differ.`, not_found: `${bankByCode[x.bank_code].name} has no record of this instrument.` }[st], { data: { status: st } });
        }
        if (x.pred) ev(x.pred, x.subAt, null, 'RENEWAL_SUBMITTED', `Renewal submitted as ${x.ref}.`);
      }
      if (x.status !== 'Submitted' && !x.legacy && !x.verified && x.status !== 'Rejected') ev(x, later(x.subAt, ri(600, 2000)), x.officer, 'SCRUTINY', null, { from: 'Submitted', to: 'Under Scrutiny' });

      // queries: on current pending items, and some resolved ones in the history
      if (x.status === 'Query Raised') {
        const raisedDay = addDays(x.sub, ri(1, Math.max(1, Math.min(5, daysBetween(x.sub, T)))));
        const raised = ts(raisedDay > T ? T : raisedDay);
        const text = QUERY_TEXT[x.plant] ?? pick(['Please upload a clearer scan of the FDR; the maturity date is not legible.', 'Please confirm whether the FDR has an auto-renewal instruction and upload the bank\'s letter.', 'The depositor name differs from the Trust name in our records. Please explain.']);
        const due = addDays(raised.slice(0, 10), 15);
        qIns.run(x.id, x.officer.id, raised, due, text, 'open', null, null, null);
        ev(x, raised, x.officer, 'QUERY_RAISED', text, { from: 'Under Scrutiny', to: 'Query Raised', data: { due } });
        mail(x, raised, 'QUERY', `${x.ref}: query from AICTE, reply by ${dmy(due)}`, text);
      } else if (x.verified && !x.legacy && chance(0.12)) {
        const raised = later(x.subAt, ri(300, 1500));
        const replied = later(raised, ri(600, 3000));
        if (replied < x.verifiedAt) {
          qIns.run(x.id, x.officer.id, raised, addDays(raised.slice(0, 10), 15), 'The board resolution uploaded is unsigned. Please upload a certified copy.', 'answered', 'Signed and certified copy of the board resolution uploaded.', replied, null);
          ev(x, raised, x.officer, 'QUERY_RAISED', 'The board resolution uploaded is unsigned. Please upload a certified copy.', { from: 'Under Scrutiny', to: 'Query Raised' });
          ev(x, replied, null, 'QUERY_ANSWERED', 'Signed and certified copy of the board resolution uploaded.', { from: 'Query Raised', to: 'Under Scrutiny' });
          discIns.run(x.id, 'MISSING_DOC', 'RESOLUTION', 'warning', 'Board resolution was unsigned.', 'Ask for a certified copy.', 'resolved', x.subAt, replied, null, null);
        }
      }
      if (x.status === 'Rejected') {
        const at = ts(x.closed);
        discIns.run(x.id, x.rejectRule, x.rejectRule === 'AMOUNT_SHORT' ? 'amount' : '', x.rejectRule === 'LIEN_NOT_AICTE' || x.rejectRule === 'AMOUNT_SHORT' ? 'serious' : 'critical', x.rejectWhy, null, 'resolved', later(x.subAt, 2), at, x.officer.id, 'Submission rejected');
        ev(x, at, x.officer, 'REJECTED', x.rejectWhy, { from: 'Under Scrutiny', to: 'Rejected' });
        mail(x, at, 'REJECTED', `${x.ref}: submission not accepted`, `Reason: ${x.rejectWhy}`);
      }
      if (x.verified) {
        ev(x, x.verifiedAt, x.verifier, 'VERIFIED', { bank_api: 'Bank confirmed all details through the verification service.', bank_letter: 'Verified against the bank confirmation letter.', officer: 'Verified by the dealing officer against the original instrument (pre-portal record).' }[x.mode],
          { from: 'Under Scrutiny', to: 'Active', data: { mode: x.mode } });
        if (!x.legacy) mail(x, x.verifiedAt, 'ACCEPTED', `${x.ref}: accepted by AICTE`, `${typeShort(x)} No. ${x.instrument_no} for ${inr(x.amount)} has been verified and taken on record.`);
        if (x.pred) ev(x.pred, x.verifiedAt, x.verifier, 'RENEWED', `Superseded by ${x.ref}.`, { from: 'Active', to: 'Renewed' });
      }

      // reminders before maturity (portal era) and maturity / overdue history
      if (x.verified && x.maturity_date && x.maturity_date < x.hold_until) {
        let stageSent = null;
        for (const s of ladder) {
          const d = addDays(x.maturity_date, -s);
          if (d < GO_LIVE || d > T || d < x.verified) continue;
          if (x.succ && x.succ.sub <= d) break;
          const at = ts(d);
          mail(x, at, 'REMINDER', `${x.ref}: ${typeShort(x)} matures on ${dmy(x.maturity_date)} - renewal required`, `${typeShort(x)} No. ${x.instrument_no} matures in ${s} day(s). Please submit the renewed instrument before maturity.`);
          if (s <= 15) mail(x, at, 'REMINDER', `${x.ref}: renewal due`, `AICTE: ${x.ref} matures ${dmy(x.maturity_date)}. Submit renewal on the SD/FDR portal.`, 'sms');
          ev(x, at, null, 'REMINDER_SENT', `T-${s} reminder sent to ${x.inst.email}${s <= 15 ? ' and by SMS' : ''}.`, { data: { stage: s } });
          stageSent = s;
        }
        if (stageSent !== null) db.prepare('UPDATE instruments SET reminder_stage = ? WHERE id = ?').run(stageSent, x.id);
      }
      if (x.maturity_date && x.maturity_date <= T && x.verified && (!x.succ?.verified || x.succ.verified > x.maturity_date) && x.status !== 'Released') {
        const renewalNeeded = x.maturity_date < x.hold_until;
        ev(x, `${x.maturity_date}T00:30:00.000Z`, null, 'MATURED', renewalNeeded ? 'Matured before the end of the holding period; renewal is now overdue.' : 'Matured after the holding period; eligible for release.', { from: 'Active', to: 'Matured' });
      }
      if (x.lapsed) {
        const overdue = daysBetween(x.maturity_date, T);
        let lastNotice = null;
        for (let d = 0; d <= overdue && d <= 84; d += DEFAULT_SETTINGS.overdue_repeat_days) {
          const day = addDays(x.maturity_date, d || 1);
          if (day > T) break;
          mail(x, ts(day), 'OVERDUE', `${x.ref}: renewal overdue by ${d || 1} day(s)`, `${typeShort(x)} No. ${x.instrument_no} matured on ${dmy(x.maturity_date)} but must be maintained until ${dmy(x.hold_until)}. Submit the renewed instrument immediately.`);
          lastNotice = day;
        }
        let level = 0;
        DEFAULT_SETTINGS.escalation_days.forEach((th, k) => {
          if (overdue >= th) {
            level = k + 1;
            ev(x, ts(addDays(x.maturity_date, th)), null, 'ESCALATED', `Renewal overdue by ${th} days: escalated to ${['Dealing Officer', 'Director, Regulation Bureau', 'Competent Authority'][k]} (level ${k + 1}).`, { data: { level: k + 1 } });
            if (k === 2) mail(x, ts(addDays(x.maturity_date, th)), 'FINAL_NOTICE', `${x.ref}: final notice - security deposit not maintained`, 'The matter has been placed before the Competent Authority.');
          }
        });
        db.prepare("UPDATE instruments SET escalation_level = ?, last_overdue_notice = ?, next_action = 'Renewal overdue: follow up with institution', next_action_due = ? WHERE id = ?").run(level, lastNotice, T, x.id);
      } else if (x.status === 'Active' && x.maturity_date && x.maturity_date < x.hold_until && !x.succ && daysBetween(T, x.maturity_date) <= 90) {
        db.prepare("UPDATE instruments SET next_action = 'Institution to submit renewed instrument', next_action_due = ? WHERE id = ?").run(x.maturity_date, x.id);
      } else if (['Submitted', 'Under Scrutiny'].includes(x.status)) {
        db.prepare("UPDATE instruments SET next_action = 'Scrutiny by dealing officer', next_action_due = ? WHERE id = ?").run(addDays(x.sub, DEFAULT_SETTINGS.scrutiny_sla_days), x.id);
      } else if (x.status === 'Query Raised') {
        db.prepare("UPDATE instruments SET next_action = 'Reply awaited from institution' WHERE id = ?").run(x.id);
      }

      // release request history
      if (x.release) {
        const rel = x.release;
        const year = rel.dates[0].slice(0, 4);
        relCount[year] = (relCount[year] ?? 0) + 1;
        const reqNo = `REL-${year}-${String(relCount[year]).padStart(5, '0')}`;
        const at = rel.dates.map((d) => ts(d));
        for (let k = 1; k < at.length; k++) if (at[k] <= at[k - 1]) at[k] = later(at[k - 1], ri(60, 600));
        const stage = rel.returned ? 'Returned' : rel.stage;
        const idx = stageOrder.indexOf(rel.stage);
        const manual = {};
        if (idx >= 1) manual.ORIGINALS = { ok: true, by: x.officer.name, at: rel.dates[1] };
        if (idx >= 3 && x.type === 'SD') manual.REFUND_ACCOUNT = { ok: true, by: staff.accounts.name, at: rel.dates[3] };
        const ref = idx >= 4 ? `AICTE/RB/REL/${year}/${reqNo.split('-').pop()}` : null;
        const r = relIns.run(reqNo, x.id, x.inst.id, rel.reason, { HOLD_COMPLETE: 'The prescribed holding period is over. Request release of the deposit.', REPLACED: 'Renewed FDR accepted; request release of the old FDR.', CLOSURE: 'Closure approved by AICTE. Request refund of the security deposit.', NOT_APPROVED: 'Application withdrawn. Request return of the deposit.' }[rel.reason],
          stage, x.prevStatus, null, at[0], JSON.stringify(manual), idx >= 1 ? x.officer.id : null, at[1] ?? null, idx >= 2 ? staff['rb.director'].id : null, at[2] ?? null,
          idx >= 3 ? staff.ms.id : null, at[3] ?? null, idx >= 4 ? staff.accounts.id : null, at[4] ?? null, ref, rel.returned ? 'Please upload the original FDR discharge form signed by the Trust Secretary.' : null, at[at.length - 1]);
        const rid = Number(r.lastInsertRowid);
        const reasonName = RELEASE_REASONS.find((y) => y.code === rel.reason).name;
        ev(x, at[0], null, 'RELEASE_REQUESTED', `${reqNo}: ${reasonName}.`, { from: x.prevStatus, to: 'Release Requested', data: { release_id: rid } });
        const steps = [null, ['Scrutinised and recommended for release', x.officer], ['Checked and forwarded to the Competent Authority', staff['rb.director']], ['Approved by the Competent Authority', staff.ms]];
        for (let k = 1; k <= Math.min(idx, 3); k++) ev(x, at[k], steps[k][1], 'RELEASE_STEP', `${reqNo}: ${steps[k][0]}`, { data: { release_id: rid, to: stageOrder[k] } });
        if (rel.returned) ev(x, later(at[at.length - 1], 120), x.officer, 'RELEASE_STEP', `${reqNo}: Returned to the institution for clarification`, { data: { release_id: rid, to: 'Returned' } });
        if (idx >= 4) {
          ev(x, at[4], staff.accounts, 'RELEASED', `${reqNo}: ${x.type === 'SD' ? 'refund processed' : 'lien release letter issued to the bank'} (${ref}).`, { from: 'Release Requested', to: 'Released', data: { release_id: rid } });
          if (!rel.legacy) {
            saveDoc(x, 'RELEASE_LETTER', `release-letter-${reqNo}.pdf`, releaseLetterPdf({ inst: x.inst, instrument: { ...x, instrument_no: normNo(x.instrument_no) }, rr: { req_no: reqNo }, approver: `${staff.ms.name}, ${staff.ms.designation}`, ref, date: rel.dates[4] }), at[4], staff.accounts, rid);
            mail(x, at[4], 'RELEASE', `${reqNo}: ${x.type === 'SD' ? 'security deposit refunded' : 'lien released'}`, `Letter ${ref} has been issued for ${x.ref}.`);
          }
        }
      }
    }
  });
  log(`  ${institutions.length} institutions, ${all.length} instruments, ${db.prepare('SELECT COUNT(*) n FROM documents').get().n} documents`);

  // ---------- rules, monitoring sweep, alerts ----------
  const engine = new Engine(db);
  const audit = makeAudit(db);
  tx(db, () => {
    for (const x of all) if (!['Renewed', 'Released', 'Rejected'].includes(x.status)) engine.evaluate(x.id);
    // findings on pending submissions date from submission, not from seeding
    db.prepare(`UPDATE discrepancies SET detected_at = (SELECT submitted_at FROM instruments x WHERE x.id = discrepancies.instrument_id) WHERE status = 'open'`).run();
    engine.sweep({ emit: false });
    audit(null, 'system.seed', 'system', null, { institutions: institutions.length, instruments: all.length });
  });

  // ---------- institution demo accounts ----------
  const pickInst = (sql) => db.prepare(sql).get(T, addDays(T, 45))?.id;
  const inst1 = pickInst(`SELECT x.institution_id AS id FROM instruments x WHERE x.status = 'Active' AND x.successor_id IS NULL AND x.maturity_date BETWEEN ? AND ? AND x.hold_until > x.maturity_date
      AND x.type = 'FDR' ORDER BY x.maturity_date DESC LIMIT 1`) ?? institutions[0].id;
  const inst2 = db.prepare(`SELECT x.institution_id AS id FROM instruments x JOIN institutions i ON i.id = x.institution_id WHERE x.status IN ('Active','Matured') AND x.hold_until < ?
      AND x.institution_id != ? AND i.open_cases = 0 AND i.dues_outstanding = 0 AND NOT EXISTS (SELECT 1 FROM release_requests r WHERE r.instrument_id = x.id) ORDER BY x.hold_until DESC LIMIT 1`).get(T, inst1)?.id ?? institutions[1].id;
  const inst3 = db.prepare(`SELECT x.institution_id AS id FROM instruments x WHERE x.status = 'Query Raised' AND x.institution_id NOT IN (?, ?) LIMIT 1`).get(inst1, inst2)?.id ?? institutions[2].id;
  tx(db, () => {
    const ins = db.prepare("INSERT INTO users (username, name, designation, email, role, institution_id, password_hash) VALUES (?,?,?,?,'institution',?,?)");
    [inst1, inst2, inst3].forEach((iid, k) => {
      const inst = institutions.find((i) => i.id === iid);
      ins.run(`institution${k + 1}`, inst.head_name, `Principal, ${inst.name}`, inst.email, iid, pw);
      instUser.set(iid, k + 1);
    });
  });
  setSetting(db, 'seeded_at', NOW);
  log(`  seeded in ${Date.now() - t0} ms`);
  return { institutions: institutions.length, instruments: all.length };
}
