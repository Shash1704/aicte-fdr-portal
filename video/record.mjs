// Records the demo video: drives the live prototype in a browser, in time with the speakers' audio.
// Every action is pinned to the second (audio time) at which its line is spoken; the timings come from
// whisper word timestamps of audio/voice.mp3 (see README in this folder).
//   node record.mjs            → out/screen.webm + out/trim.txt (seconds to cut from the start)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.DEMO_URL || 'https://shash1704.github.io/aicte-fdr-portal/';
const OUT = path.resolve('out');
const END = 249.5; // audio length + a short hold on the last card
fs.mkdirSync(OUT, { recursive: true });

// ---------------- in-page helpers: cursor, highlight box, full-screen cards, part chip ----------------
const INIT = () => {
  const install = () => {
    if (document.getElementById('__cursor')) return;
    const st = document.createElement('style');
    st.textContent = `
      #__cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:transform .05s}
      #__cursor svg{filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}
      .__ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #d8f06a;z-index:2147483646;pointer-events:none;animation:__rip .55s ease-out forwards}
      @keyframes __rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
      #__hl{position:fixed;z-index:2147483645;pointer-events:none;border:3px solid #d8f06a;border-radius:22px;box-shadow:0 0 0 9999px rgba(0,0,0,.28),0 0 28px rgba(216,240,106,.55);opacity:0;transition:opacity .25s,left .35s,top .35s,width .35s,height .35s}
      #__card{position:fixed;inset:0;z-index:2147483640;background:radial-gradient(120% 90% at 50% 0%,#202020 0%,#0b0b0b 100%);color:#f4f4f4;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .45s;pointer-events:none;font-family:"Plus Jakarta Sans Variable","Plus Jakarta Sans",system-ui,sans-serif}
      #__card.on{opacity:1}
      #__card .wrap{width:min(1180px,86vw)}
      #__card .eyebrow{font-size:15px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#9a9a9a}
      #__card h1{font-size:68px;line-height:1.04;font-weight:800;margin:18px 0 0;letter-spacing:-.01em}
      #__card .lime{color:#d8f06a}
      #__card p{font-size:24px;line-height:1.5;color:#bdbdbd;margin:22px 0 0;max-width:900px}
      #__card .tag{display:inline-block;background:#d8f06a;color:#141414;font-weight:800;font-size:16px;border-radius:999px;padding:7px 16px}
      #__card ul{list-style:none;padding:0;margin:40px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:18px}
      #__card li{display:flex;gap:16px;align-items:center;background:#1e1e1e;border-radius:24px;padding:22px 24px;font-size:24px;font-weight:600;opacity:0;transform:translateY(12px);transition:opacity .4s,transform .4s}
      #__card li.on{opacity:1;transform:none}
      #__card li .dot{flex:none;width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px}
      #__card .logo{width:64px;height:64px}
      #__card .link{margin-top:34px;display:inline-block;background:#d8f06a;color:#141414;font-size:34px;font-weight:800;border-radius:999px;padding:16px 34px}
      #__chip{position:fixed;top:22px;left:50%;transform:translateX(-50%);z-index:2147483639;background:#050505;color:#f4f4f4;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:8px 18px 8px 8px;font:600 15px "Plus Jakarta Sans Variable",system-ui,sans-serif;display:flex;align-items:center;gap:10px;opacity:0;transition:opacity .35s;pointer-events:none}
      #__chip b{background:#d8f06a;color:#141414;border-radius:999px;width:28px;height:28px;display:flex;align-items:center;justify-content:center}
      #__letter{position:fixed;inset:0;z-index:2147483641;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .35s;pointer-events:none}
      #__letter img{width:min(1180px,80vw);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.7)}
      html.__carding #__cursor{opacity:0}`;
    document.documentElement.appendChild(st);
    const c = document.createElement('div');
    c.id = '__cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.4L9.8 20z" fill="#fff" stroke="#141414" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const pos = window.__pos || { x: innerWidth / 2, y: innerHeight / 2 };
    c.style.left = pos.x + 'px'; c.style.top = pos.y + 'px';
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; window.__pos = { x: e.clientX, y: e.clientY }; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div'); r.className = '__ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
    for (const id of ['__hl', '__card', '__chip', '__letter']) { const d = document.createElement('div'); d.id = id; document.documentElement.appendChild(d); }
  };
  // keep the last file the app hands to the browser (the release letter PDF), so it can be shown in-page
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { if (b && b.type === 'application/pdf') window.__lastPdf = b; return orig(b); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  window.__install = install;
};

const LOGO = '<svg class="logo" viewBox="0 0 40 40"><path d="M8 31 19 13M18 31 29 13" stroke="#d8f06a" stroke-width="5.5" stroke-linecap="round"/><circle cx="31.5" cy="9" r="3.4" fill="#d8f06a"/></svg>';

// ---------------- runner ----------------
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25,
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
});
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
const videoStart = Date.now();
page.setDefaultTimeout(20000);

let t0 = 0;
const now = () => (Date.now() - t0) / 1000;
const late = [];
const FAST = process.env.FAST === '1'; // dry run: no waiting for the audio
process.on('uncaughtException', async (e) => {
  console.error('FAILED:', e.message.split('\n')[0]);
  await page.screenshot({ path: path.join(OUT, 'fail.png') }).catch(() => {});
  process.exit(1);
});
async function at(t, label) {
  if (FAST) { console.log(`${t.toFixed(1).padStart(6)}  ${label}`); return; }
  const wait = t - now();
  if (wait > 0) await page.waitForTimeout(wait * 1000);
  else if (wait < -0.4) late.push(`${label}: ${(-wait).toFixed(1)}s late`);
}
const sleep = (s) => page.waitForTimeout(s * 1000);
const ensure = () => page.evaluate(() => window.__install && window.__install());

async function moveTo(loc, steps = 18) {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box for ' + loc);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps });
  return b;
}
// Real click through Playwright too, in case the element moved during the cursor glide.
async function press(loc, steps = 16) {
  await ensure();
  await moveTo(loc, steps);
  await sleep(0.1);
  await loc.click({ timeout: 8000 });
}
async function highlight(loc, ms = 2600, pad = 8) {
  await ensure();
  const b = await loc.boundingBox();
  if (!b) return;
  await page.evaluate(([x, y, w, h, ms]) => {
    const el = document.getElementById('__hl');
    Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', opacity: '1' });
    clearTimeout(window.__hlT); window.__hlT = setTimeout(() => { el.style.opacity = '0'; }, ms);
  }, [b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2, ms]);
}
async function scrollTo(loc, block = 'center') {
  await loc.evaluate((el, block) => el.scrollIntoView({ behavior: 'smooth', block }), block);
  await sleep(0.7);
}
async function chip(n, text) {
  await ensure();
  await page.evaluate(([n, text]) => {
    const el = document.getElementById('__chip');
    el.innerHTML = n ? `<b>${n}</b>${text}` : '';
    el.style.opacity = n ? '1' : '0';
  }, [n, text]);
}
async function card(html) {
  await ensure();
  await page.evaluate((html) => {
    const el = document.getElementById('__card');
    if (html === null) { el.classList.remove('on'); document.documentElement.classList.remove('__carding'); return; }
    document.documentElement.classList.add('__carding');
    el.innerHTML = `<div class="wrap">${html}</div>`;
    void el.offsetWidth; // start the fade from the current state
    el.classList.add('on');
  }, html);
}
async function showItem(i) { await page.evaluate((i) => document.querySelectorAll('#__card li')[i]?.classList.add('on'), i); }
async function signInAs(text) {
  await press(page.locator('aside button[aria-label="Account"]'), 12);
  await press(page.getByRole('button', { name: 'Sign out' }), 8);
  await press(page.locator('button', { hasText: text }).first(), 14);
  // signing in keeps the current address: go to the new user's home page
  await press(page.locator('aside a[aria-label="AICTE SD/FDR portal home"]'), 6);
}
const nav = (label) => page.locator(`aside a[aria-label="${label}"]`);
const cardSection = (title) => page.locator('section.glass', { has: page.locator('h2', { hasText: title }) }).first();

// ---------------- warm-up (cut from the final video) ----------------
await page.goto(URL);
await page.locator('button', { hasText: 'Director, Regulation Bureau' }).waitFor({ timeout: 90000 });
await ensure();
await page.mouse.move(980, 520);
t0 = Date.now();
fs.writeFileSync(path.join(OUT, 'trim.txt'), String((t0 - videoStart) / 1000));

// ================= PART 1 · Opening and the problem (0:00–0:39) =================
await card(`${LOGO}<div class="eyebrow" style="margin-top:28px">Smart India Hackathon 2026 · SIH26265 · AICTE Regulation Bureau</div>
  <h1>Streamline of security<br>deposit / <span class="lime">FDR portal</span></h1>
  <p>Team Varangians</p>`);
await at(9.2, 'what is an FDR');
await card(`<span class="tag">Background</span>
  <h1>When a college gets AICTE approval,<br>it keeps money with AICTE<br>as a <span class="lime">safety deposit</span>.</h1>
  <p>Usually this is a fixed deposit in a bank — an <b style="color:#fff">FDR</b>.</p>`);
await at(20.6, 'problem card');
await card(`<span class="tag" style="background:#ee7b7b">The problem today</span>
  <h1>Deposits are tracked on paper</h1>
  <ul>
    <li><span class="dot" style="background:#f0c062;color:#141414">1</span>Kept in files and spreadsheets</li>
    <li><span class="dot" style="background:#ee7b7b;color:#141414">2</span>Nobody checks with the bank</li>
    <li><span class="dot" style="background:#9d6cf0;color:#141414">3</span>No reminder when an FDR ends</li>
    <li><span class="dot" style="background:#5ec8d8;color:#141414">4</span>Weeks of letters to give money back</li>
  </ul>`);
await at(22.4, 'p1'); await showItem(0);
await at(24.2, 'p2'); await showItem(1);
await at(27.3, 'p3'); await showItem(2);
await at(29.8, 'p4'); await showItem(3);
await at(33.2, 'solution card');
await card(`${LOGO}<h1 style="margin-top:26px">One portal that <span class="lime">checks every deposit<br>with the bank</span> and watches every date.</h1>`);
await at(38.8, 'to app');
await card(null);

// ================= PART 2 · The dashboard (0:39–1:16) =================
await at(40.4, 'sign in director');
await chip(2, 'The dashboard');
await press(page.locator('button', { hasText: 'Director, Regulation Bureau' }).first(), 16);
await page.locator('section.hero').waitFor();
await at(43.0, 'chart');
await highlight(page.locator('section.hero > div > div').first(), 5200);
await at(48.6, 'bigger bubble');
await moveTo(page.locator('section.hero svg circle[fill="#d8f06a"]').first(), 20);
await at(51.3, 'red bubble');
await moveTo(page.locator('section.hero svg circle[fill="#ee7b7b"]').first(), 20);
await at(53.5, 'weekly');
await highlight(page.locator('section.hero > div > div').nth(1), 6400);
await moveTo(page.locator('section.hero > div > div').nth(1).locator('div.rounded-full.bg-\\[\\#5a5a5a\\]').nth(5), 22);
await at(57.4, 'lime part');
await moveTo(page.locator('section.hero > div > div').nth(1).locator('div.bg-\\[\\#d8f06a\\]').first(), 14);
await at(60.5, 'four cards');
const stats = page.locator('section.glass').filter({ has: page.locator('a[href*="validity=lapsed"]') }).first().locator('> div').first();
await highlight(stats, 8200);
await moveTo(stats.locator('a').nth(0), 16);
await at(64.0, 'card 2'); await moveTo(stats.locator('a').nth(1), 14);
await at(65.5, 'card 3'); await moveTo(stats.locator('a').nth(2), 14);
await at(67.0, 'card 4'); await moveTo(stats.locator('a').nth(3), 14);
await at(69.2, 'agenda');
await highlight(page.locator('aside[aria-label="Agenda"]'), 4200);
await moveTo(page.locator('aside[aria-label="Agenda"]').locator('span', { hasText: 'Today' }).first(), 18);
await at(73.6, 'click agenda item');
await press(page.locator('aside[aria-label="Agenda"] li a').first(), 14);
await page.locator('section.glass', { has: page.locator('h2', { hasText: 'Three-way check' }) }).waitFor().catch(() => {});

// ================= PART 3 · A college renews its FDR (1:16–1:47) =================
await at(76.8, 'sign in college');
await chip(3, 'A college renews its FDR');
await signInAs('Institution login');
const todo = cardSection('To do');
await todo.waitFor();
const college = (await page.locator('h1').first().innerText()).trim();
await at(79.0, 'to do');
await highlight(todo, 4300);
await moveTo(todo.locator('li').first(), 16);
await at(83.2, 'submit renewal');
await press(page.getByRole('button', { name: 'Submit renewal' }).first(), 14);
await page.getByText('Try a sample FDR').waitFor();
await at(87.6, 'sample');
await press(page.locator('button', { hasText: 'Valid FDR, State Bank of India' }), 18);
await page.getByText(/details read from the document/).waitFor({ timeout: 30000 });
await at(89.9, 'read fields');
const confirm = cardSection('3 · Confirm the details');
await scrollTo(confirm, 'start');
await highlight(confirm, 5600);
await moveTo(confirm.locator('input').nth(0), 16);
await at(92.6, 'fdr number'); await moveTo(confirm.locator('input').nth(0), 10);
await at(93.6, 'amount'); await moveTo(confirm.locator('input').nth(1), 10);
await at(94.4, 'date'); await moveTo(confirm.locator('input').nth(2), 10);
await at(96.2, 'submit');
await press(page.getByRole('button', { name: 'Submit', exact: true }), 20);
const three = cardSection('Three-way check');
await three.waitFor({ timeout: 30000 });
await at(98.0, 'three-way');
await scrollTo(three, 'center');
await highlight(three, 7200);
for (const [t, row] of [[100.0, 0], [101.2, 1], [102.2, 3], [104.0, 6]]) {
  await at(t, 'row'); await moveTo(three.locator('tbody tr').nth(row).locator('td').nth(3), 10);
}

// ================= PART 4 · Catching a fake FDR (1:47–2:36) =================
await at(106.6, 'chip 4');
await chip(4, 'Catching a fake FDR');
await at(109.8, 'plus');
await press(page.locator('a[aria-label="Submit an FDR"]'), 22);
await page.getByText('Try a sample FDR').waitFor();
await at(112.8, 'altered sample');
await press(page.locator('button', { hasText: 'Altered FDR' }), 18);
await page.getByText(/details read from the document/).waitFor({ timeout: 30000 });
await sleep(0.4);
await press(page.getByRole('button', { name: 'Submit', exact: true }), 20);
const three2 = cardSection('Three-way check');
await three2.waitFor({ timeout: 30000 });
await page.evaluate(() => document.getElementById('main-scroll')?.scrollTo({ top: 0 }));
await at(116.4, 'paper says');
const amountRow = three2.locator('tbody tr', { hasText: 'Amount' }).first();
await scrollTo(three2, 'center');
await highlight(amountRow.locator('td').nth(2), 2600, 6);
await moveTo(amountRow.locator('td').nth(2), 16);
await at(119.3, 'bank says');
await highlight(amountRow.locator('td').nth(3), 2800, 6);
await moveTo(amountRow.locator('td').nth(3), 12);
await at(122.2, 'blocked');
await page.evaluate(() => document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }));
await sleep(0.6);
const banner = page.getByText(/blocking discrepanc/).first().locator('xpath=ancestor::div[contains(@class,"border")][1]');
await highlight(banner, 3000);
await moveTo(banner, 14);
await at(125.6, 'other checks');
const disc = cardSection('Discrepancies');
await scrollTo(disc, 'center');
await highlight(disc, 3800);
await at(130.5, 'rules list');
await moveTo(disc.locator('li').first(), 14);
await at(136.2, 'director again');
await signInAs('Director, Regulation Bureau');
await page.locator('section.hero').waitFor();
await at(138.2, 'register');
await press(nav('Register'), 14);
const search = page.getByPlaceholder(/FDR \/ BG number/);
await press(search, 12);
await search.pressSequentially(college.slice(0, 22), { delay: 22 });
await page.locator('tbody tr', { hasText: 'Bank: details differ' }).first().waitFor({ timeout: 20000 });
await at(140.8, 'open fake');
await press(page.locator('tbody tr', { hasText: 'Bank: details differ' }).first().locator('a').first(), 14);
await page.getByRole('button', { name: 'Raise query' }).waitFor();
await at(142.2, 'raise query');
await press(page.getByRole('button', { name: 'Raise query' }), 14);
const dlg = page.locator('[role=dialog]');
await dlg.waitFor();
await at(144.0, 'prefilled');
await highlight(dlg.locator('textarea'), 2800, 6);
await moveTo(dlg.locator('textarea'), 14);
await at(146.8, 'send');
await press(dlg.getByRole('button', { name: 'Submit' }), 14);
await at(147.6, 'real one');
await page.goBack();
const realRow = page.locator('tbody tr').filter({ hasNotText: 'Bank: details differ' }).filter({ hasText: 'Submitted' }).first();
await realRow.waitFor({ timeout: 15000 });
await press(realRow.locator('a').first(), 14);
await page.getByRole('button', { name: 'Accept', exact: true }).waitFor();
await at(149.6, 'accept');
await press(page.getByRole('button', { name: 'Accept', exact: true }), 14);
await dlg.waitFor();
await highlight(dlg.locator('label').first(), 2000, 4);
await sleep(0.9);
await press(dlg.getByRole('button', { name: 'Accept' }), 12);
await at(152.0, 'accepted badge');
await highlight(page.locator('span', { hasText: 'Bank-confirmed (online)' }).first(), 2600, 6);

// ================= PART 5 · Watching every date (2:36–3:26) =================
await at(156.2, 'member secretary');
await chip(5, 'Watching every date');
await signInAs('Member Secretary (Competent Authority)');
await page.locator('section.hero').waitFor();
const attention = cardSection('Needs attention');
await at(158.6, 'scroll to attention');
await scrollTo(attention, 'center');
await at(161.0, 'asks bank again');
await highlight(attention, 3600);
await at(164.9, 'two encashed');
const enc = attention.locator('li', { hasText: 'Bank: encashed' });
await highlight(enc.first(), 1500, 6);
await moveTo(enc.first(), 16);
await sleep(1.3);
await highlight(enc.nth(1), 1500, 6);
await moveTo(enc.nth(1), 12);
await at(168.6, 'open encashed');
await press(enc.first().locator('a'), 12);
const encBanner = page.getByText(/encashed before maturity/).first().locator('xpath=ancestor::div[contains(@class,"border")][1]');
await encBanner.waitFor();
await at(170.4, 'banner');
await highlight(encBanner, 3800);
await moveTo(encBanner, 14);
await at(175.6, 'reminders');
await press(nav('Maturity calendar'), 16);
await page.getByText('Maturity calendar', { exact: true }).first().waitFor();
await sleep(0.5);
const dayCells = page.locator('div.grid.grid-cols-7 > button');
const cells = await dayCells.count();
for (const [t, i] of [[179.6, 0.35], [181.4, 0.5], [182.6, 0.65], [184.0, 0.8]]) {
  await at(t, 'day'); await moveTo(dayCells.nth(Math.floor(cells * i)), 12);
}
await at(185.6, 'escalation');
await press(nav('Alerts'), 16);
await page.getByRole('tab', { name: /Renewal overdue/ }).click().catch(() => {});
await sleep(0.4);
await highlight(page.locator('section.glass').first(), 4200);
await at(191.8, 'admin');
await press(nav('Administration'), 16);
await page.getByRole('button', { name: '+30 days' }).waitFor();
await at(194.4, 'plus 30');
await press(page.getByRole('button', { name: '+30 days' }), 14);
await page.locator('[aria-live="polite"] > div').first().waitFor({ timeout: 30000 });
await at(197.4, 'toast');
await highlight(page.locator('[aria-live="polite"] > div').first(), 4200, 6);
await moveTo(page.locator('[aria-live="polite"] > div').first(), 18);
await at(203.6, 'back to today');
await press(page.getByRole('button', { name: 'Back to today' }), 14);

// ================= PART 6 · Giving a deposit back, and the close (3:26–4:07) =================
await at(208.3, 'releases');
await chip(6, 'Giving a deposit back');
await press(nav('Releases'), 16);
const allMet = page.locator('tbody tr', { hasText: 'All met' }).first();
await allMet.waitFor();
const reqNo = (await allMet.locator('a').first().innerText()).trim();
await at(210.0, 'open release');
await press(allMet.locator('a').first(), 14);
const conditions = cardSection('Conditions for release');
await conditions.waitFor();
await at(213.0, 'conditions');
await highlight(conditions, 7000);
for (const [t, i] of [[214.9, 1], [215.8, 2], [216.8, 3], [219.6, 4]]) { await at(t, 'cond'); await moveTo(conditions.locator('li').nth(i), 10); }
await at(220.4, 'stages');
await page.evaluate(() => document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }));
await sleep(0.5);
const stages = page.locator('section.glass').filter({ has: page.locator('ol') }).first();
await highlight(stages, 4400);
await moveTo(stages.locator('li').nth(1), 14);
await at(222.6, 'officer'); await moveTo(stages.locator('li').nth(1), 8);
await at(223.6, 'director'); await moveTo(stages.locator('li').nth(2), 8);
await at(224.3, 'me'); await moveTo(stages.locator('li').nth(3), 8);
await at(225.2, 'approve');
await press(page.getByRole('button', { name: 'Approve release' }), 14);
await page.locator('li', { hasText: 'Approved' }).first().waitFor().catch(() => {});
await at(226.9, 'accounts');
await signInAs('Accounts Officer, Finance');
await press(nav('Releases'), 10);
await press(page.locator('tbody tr', { hasText: reqNo }).locator('a').first(), 10);
await press(page.getByRole('button', { name: 'Issue release letter' }), 10);
const letterBtn = page.locator('button', { hasText: 'Release letter' }).first();
await letterBtn.waitFor();
ctx.once('page', (p) => p.close().catch(() => {})); // the app opens the letter in a new tab; show it in-page instead
await page.evaluate(() => { window.__lastPdf = null; });
await press(letterBtn, 8);
await page.waitForFunction(() => window.__lastPdf, null, { timeout: 8000 }).catch(() => {});
const b64 = await page.evaluate(async () => {
  if (!window.__lastPdf) return null;
  const buf = new Uint8Array(await window.__lastPdf.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  return btoa(s);
});
if (b64) {
  fs.writeFileSync(path.join(OUT, 'letter.pdf'), Buffer.from(b64, 'base64'));
  // the letter fills only the top of an A4 page: crop to the written part so it reads at video size
  execFileSync('pdftoppm', ['-png', '-r', '150', '-singlefile', '-x', '60', '-y', '70', '-W', '1120', '-H', '640', path.join(OUT, 'letter.pdf'), path.join(OUT, 'letter')]);
  const png = fs.readFileSync(path.join(OUT, 'letter.png')).toString('base64');
  await page.evaluate((png) => {
    const el = document.getElementById('__letter');
    el.innerHTML = `<img src="data:image/png;base64,${png}">`;
    el.style.opacity = '1';
  }, png);
}
await at(231.6, 'closing card');
await chip(0, '');
await card(`${LOGO}<h1 style="margin-top:22px;font-size:56px">The SD/FDR portal</h1>
  <ul>
    <li><span class="dot" style="background:#d8f06a;color:#141414">✓</span>Every deposit checked with the bank</li>
    <li><span class="dot" style="background:#d8f06a;color:#141414">✓</span>Every date watched</li>
    <li><span class="dot" style="background:#d8f06a;color:#141414">✓</span>Money back only with the right approvals</li>
    <li><span class="dot" style="background:#d8f06a;color:#141414">✓</span>Every click saved in a record nobody can change</li>
  </ul>`);
await page.evaluate(() => { document.getElementById('__letter').style.opacity = '0'; });
await at(233.7, 'c1'); await showItem(0);
await at(235.0, 'c2'); await showItem(1);
await at(236.1, 'c3'); await showItem(2);
await at(239.2, 'c4'); await showItem(3);
await at(243.4, 'link card');
await card(`${LOGO}<div class="eyebrow" style="margin-top:26px">Try it live — it runs in your browser</div>
  <div class="link">shash1704.github.io/aicte-fdr-portal</div>
  <p>Team Varangians · SIH 2026 · SIH26265 · AICTE Regulation Bureau</p>`);
await at(END, 'end');

await ctx.close();
await browser.close();
const webm = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm')).map((f) => path.join(OUT, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
fs.renameSync(webm, path.join(OUT, 'screen.webm'));
console.log('college:', college, '· release:', reqNo);
console.log(late.length ? 'LATE STEPS:\n' + late.join('\n') : 'All steps on time');
