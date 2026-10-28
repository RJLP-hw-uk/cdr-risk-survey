// End-to-end click tests for the survey page against a mocked claude.ai runtime.
const { chromium } = require('playwright');
const path = require('path');
const PAGE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const MOCK = require('fs').readFileSync(path.join(__dirname, 'mock.js'), 'utf8');
let fails = 0, passes = 0;
function check(c, msg){ if (c) { passes++; } else { fails++; console.log('  FAIL: ' + msg); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 3000){ const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) {} await sleep(40); } return false; }

async function newCtx(browser, role, opts = {}){
  const ctx = await browser.newContext({viewport: opts.viewport || {width:1366, height:768}});
  ctx.db = {text: opts.seed ? JSON.stringify(opts.seed) : '{}'};
  await ctx.exposeFunction('__dbget', () => ctx.db.text);
  await ctx.exposeFunction('__dbput', s => { ctx.db.text = s; });
  await ctx.addInitScript(([r, u, seed]) => { localStorage.setItem('__role', r); if (u) localStorage.setItem('__uid', u);  }, [role, opts.uid || '', opts.seed ? JSON.stringify(opts.seed) : '']);
  if (role !== 'none' || true) await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text()) && !/ERR_/.test(m.text())) page.errors.push('console: ' + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  page.posts = [];
  await page.route(/docs\.google\.com\/forms/, r => { page.posts.push(r.request().postData()); r.fulfill({status:200, body:'ok'}); });
  await page.goto(PAGE); await sleep(200);
  return {ctx, page};
}
const step = p => p.evaluate(() => JSON.parse(localStorage.getItem('cdr-risk-survey-v4') || '{}').step);
const state = p => p.evaluate(() => JSON.parse(localStorage.getItem('cdr-risk-survey-v4') || '{}'));
const store = p => Promise.resolve(JSON.parse(p.context().db.text || '{}'));
const h2 = p => p.$eval('#app h2', e => e.textContent).catch(() => '');
async function clickNext(p){ await p.click('#next'); await sleep(60); }
async function rateAll(p, scn, picks){ // picks: array of [L,I] or 'ns', length 9
  for (let i = 0; i < 9; i++) {
    const before = await step(p);
    check(before === scn + ':' + ['TEC','RES','PRI','POL','CUR','CON','CPT','PER','SOC'][i], `expected ${scn} risk ${i+1}, got ${before}`);
    const v = picks[i];
    if (v === 'ns') { await p.click('#ns'); await sleep(60); }
    else { await p.click(`.cell[data-l="${v[0]}"][data-i="${v[1]}"]`); await sleep(330); }
  }
}
async function about(p, exp, sector, cat){
  const s0 = await step(p); check(s0 === undefined || s0 === 'q1', 'starts on q1 (' + s0 + ')');
  await p.click('#exp' + exp); await sleep(300);
  check(await step(p) === 'q2', 'auto-advance q1 -> q2');
  await p.click('#sector' + sector); await sleep(300);
  check(await step(p) === 'q3', 'auto-advance q2 -> q3');
  await p.click('#c-' + cat); await sleep(50);
  check(await p.$eval('#next', b => !b.disabled), 'Next enabled after picking a technology');
  await clickNext(p);
}
const P9 = (L, I) => Array(9).fill([L, I]);

(async () => {
  const browser = await chromium.launch();

  // ---------- S1: editor interview, paired technology, with navigation detours
  console.log('S1 editor interview (DAC solid sorbent, paired)');
  let {ctx, page: p} = await newCtx(browser, 'editor');
  await sleep(150);
  check(await p.isVisible('#toggle-results'), 'Responses button visible to editor');
  await about(p, 1, 2, 'dac_ss');
  check(await step(p) === 'sa:TEC', 'lands on part 1 first risk');
  await p.click('.cell[data-l="4"][data-i="3"]'); await sleep(330);
  check(await step(p) === 'sa:RES', 'auto-advance after first rating');
  await p.click('#back'); await sleep(60);
  check(await step(p) === 'sa:TEC', 'Back returns to TEC');
  check(await p.$eval('.cell[data-l="4"][data-i="3"]', e => e.classList.contains('picked')), 'previous answer shown as picked');
  await p.click('.cell[data-l="2"][data-i="2"]'); await sleep(400);
  check(await step(p) === 'sa:TEC', 'changing an existing answer does not auto-advance');
  check(JSON.stringify((await state(p)).ratings.sa.TEC) === '[2,2]', 'changed answer stored');
  await p.click('.dot[data-r="PRI"]'); await sleep(60);
  check(await step(p) === 'sa:PRI', 'risk dot jumps to PRI');
  await p.click('.dot[data-r="RES"]'); await sleep(60);
  await ctx.close();

  // ---------- S1 (clean run): editor completes three interviews
  ({ctx, page: p} = await newCtx(browser, 'editor'));
  await sleep(150);
  await about(p, 1, 2, 'dac_ss');
  await rateAll(p, 'sa', [[4,3],[3,3],'ns',[2,4],[3,2],[4,4],[1,3],[2,2],[5,5]]);
  check(await step(p) === 'int', 'after part 1 the integration intro appears');
  check((await h2(p)) === 'DAC at a data centre', 'integration title shown');
  check(await p.$$eval('.kind', els => els.map(e => e.textContent).join(',')) === 'Co-location,Co-product', 'integration type labels shown');
  await p.keyboard.press('ArrowRight'); await sleep(60);
  check(await step(p) === 'int:TEC', 'ArrowRight presses Start on the intro');
  check(await p.$$eval('#app .cell span', els => els.length) === 0, 'part 2 grid shows no part 1 or other-risk labels');
  await p.click('.cell[data-l="3"][data-i="3"]'); await sleep(330);
  check(await step(p) === 'int:RES', 'part 2 advances to second risk');
  check(await p.$$eval('#app .cell span', els => els.length) === 0, 'next risk grid shows no labels from earlier risks');
  for (const v of [[3,3],[3,2],[2,4],[4,3],[3,3],[2,3],[2,2],[4,4]]) { await p.click(`.cell[data-l="${v[0]}"][data-i="${v[1]}"]`); await sleep(330); }
  check(await step(p) === 'rank', 'last question after part 2');
  await p.click('.info[data-i="CUR"]'); await sleep(30);
  check(await p.isVisible('#d-CUR'), 'info opens definition');
  await p.click('.info[data-i="TEC"]'); await sleep(30);
  check(!(await p.isVisible('#d-CUR')) && await p.isVisible('#d-TEC'), 'only one definition open at a time');
  await p.click('.info[data-i="TEC"]'); await sleep(30);
  check(!(await p.isVisible('#d-TEC')), 'info closes on second click');
  await p.fill('#w-TEC', '9'); await p.fill('#w-PRI', '2');
  check(await p.$eval('#wv-TEC', e => e.textContent) === '9', 'slider value label updates');
  await p.click('#back'); await sleep(60);
  check(await step(p) === 'int:SOC', 'Back from last question goes to last risk');
  await clickNext(p);
  check(await p.$eval('#w-TEC', e => e.value) === '9' && await p.$eval('#w-PRI', e => e.value) === '2', 'slider values kept after Back/Next');
  await p.focus('body'); await p.keyboard.press('ArrowRight'); await sleep(60);
  check(await step(p) === 'review', 'ArrowRight leaves the last question');
  s = await state(p);
  check(s.rankDone === true && s.weights.TEC === 9 && s.weights.PRI === 2 && s.weights.SOC === 5, 'keyboard Next saved slider values');
  check(await p.isVisible('#ref'), 'respondent reference field shown to editor');
  await p.fill('#ref', 'R1');
  await p.click('#addc'); await p.fill('#comment', 'test comment 1');
  await p.click('#next'); await p.click('#next').catch(()=>{}); await sleep(250);
  let st = await store(p);
  let ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 1, 'double-click on Submit stores exactly one record (got ' + ids.length + ')');
  let d1 = st[ids[0]];
  check(d1 && d1.ref === 'R1' && d1.mode === 'interview' && d1.source === 'interview', 'record carries reference and interview mode');
  check(d1 && Object.keys(d1.ratings.sa).length === 9 && d1.ratings.sa.PRI === 'ns' && Object.keys(d1.ratings.int).length === 9, 'record has 9 + 9 ratings with not-sure');
  check(d1 && d1.weights && d1.weights.TEC === 9 && d1.integration.model === 'DAC_DC' && d1.modelStandalone === 'DAC_SS', 'record has weights and model links');
  check(d1 && d1.comment === 'test comment 1' && d1.exp === '2–5 years' && d1.sector === 'Academia or research', 'record has comment and background');
  check((await h2(p)) === 'Saved.', 'editor sees Saved.');
  check(await p.isVisible('#nextresp'), 'Start next response button shown');
  // correct the saved response: redo importance
  await p.click('[data-redo="rank"]'); await sleep(60);
  check(await step(p) === 'rank', 'Redo importance opens last question');
  await p.fill('#w-SOC', '10'); await clickNext(p); await clickNext(p); await sleep(250);
  st = await store(p); ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 1 && st[ids[0]].weights.SOC === 10 && st[ids[0]].weights.TEC === 5, 'correction overwrites the same record');
  // reload on done screen keeps it
  await sleep(1200); await p.reload(); await sleep(300);
  check(await until(async () => (await h2(p)) === 'Saved.'), 'done screen survives reload');
  if (!(await until(async()=>true))) {} ; { const _s = await state(p); const _h = await h2(p); if (!(_s.step === 'sa:TEC' || _h === 'Saved.')) console.log('   DEBUG '+'done screen survives reload'+': step=', _s.step, 'done=', !!_s.done, 'h2=', _h, 'url=', p.url(), 'errors=', p.errors.join('|')); }
  // next response
  await p.click('#nextresp'); await sleep(60);
  s = await state(p);
  check(s.step === 'q1' && s.exp === null && s.cat === null && !s.docId && !s.ref, 'Start next response gives a blank form');
  check(await p.$$eval('input:checked', els => els.length) === 0, 'no option pre-selected for next respondent');

  // interview 2: unpaired technology, skip importance, rapid clicks
  await p.click('#exp0'); await p.click('#next'); await sleep(400);
  check(await step(p) === 'q2', 'quick select + Next does not skip a question (q2)');
  await p.click('#sector0'); await p.click('#next'); await sleep(400);
  check(await step(p) === 'q3', 'quick select + Next does not skip a question (q3)');
  await p.click('#c-ccs_eor'); await clickNext(p);
  check((await h2(p)) === 'Less CO₂ is captured and stored than planned' || (await step(p)) === 'sa:TEC', 'CCS wording');
  await p.click('.cell[data-l="3"][data-i="3"]'); await p.click('#next'); await sleep(400);
  check(await step(p) === 'sa:RES', 'tap + immediate Next advances exactly one risk');
  check((await h2(p)) === 'Less CO₂ is captured and stored than planned', 'CCS uses captured-and-stored wording');
  for (let k = 0; k < 12 && (await step(p)).startsWith('sa:'); k++) { await p.click('.cell[data-l="2"][data-i="3"]'); await sleep(330); }
  check(await step(p) === 'rank', 'unpaired technology goes straight to the last question');
  await p.click('#wskip'); await sleep(60);
  check(await step(p) === 'review', 'Skip goes to review');
  check(await p.$eval('.list', e => e.textContent.includes('Skipped')), 'review shows importance skipped');
  check(!(await p.$('[data-redo="int"]')), 'no part 2 row for unpaired technology');
  await p.fill('#ref', 'R2'); await clickNext(p); await sleep(250);
  st = await store(p); ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 2, 'second interview stored as a separate record');
  const d2 = ids.map(k => st[k]).find(x => x.ref === 'R2');
  check(d2 && d2.weights === null && d2.integration === null && d2.cat === 'ccs_eor', 'unpaired record has no integration or weights');
  await p.click('#nextresp'); await sleep(60);

  // interview 3: change technology part-way, start over arming
  await about(p, 3, 0, 'dac_ss');
  await p.click('.cell[data-l="2"][data-i="2"]'); await sleep(330);
  for (let k = 0; k < 2; k++) await p.click('#back');
  await sleep(60);
  check(await step(p) === 'q3', 'Back reaches technology question');
  await p.click('#c-cew'); await clickNext(p);
  check(Object.keys((await state(p)).ratings.sa).length === 0, 'changing technology clears earlier ratings');
  await rateAll(p, 'sa', P9(3, 4));
  check((await h2(p)) === 'Coastal weathering in beach nourishment', 'CEW integration intro');
  await clickNext(p);
  await rateAll(p, 'int', P9(2, 3));
  await clickNext(p); // accept default sliders
  check(await step(p) === 'review', 'review reached');
  await p.click('#startover'); await sleep(30);
  check(await step(p) === 'review' && (await p.$eval('#startover', e => e.textContent)).includes('again'), 'Start over needs a second tap');
  await p.click('[data-redo="int"]'); await sleep(60);
  check(await step(p) === 'int', 'Redo part 2 opens the integration intro');
  check(Object.keys((await state(p)).ratings.int).length === 0, 'Redo part 2 cleared part 2 only');
  check(Object.keys((await state(p)).ratings.sa).length === 9, 'part 1 kept');
  await clickNext(p); await rateAll(p, 'int', P9(1, 2)); await clickNext(p);
  await p.fill('#ref', 'R3'); await clickNext(p); await sleep(250);
  st = await store(p); ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 3, 'three interviews stored');

  // fit-to-screen check on a risk screen after re-renders
  await p.click('#nextresp'); await about(p, 0, 0, 'biochar');
  await p.click('.cell[data-l="3"][data-i="3"]'); await sleep(330); await p.click('#back'); await sleep(60);
  await p.click('.cell[data-l="4"][data-i="4"]'); await sleep(100); await p.click('.cell[data-l="5"][data-i="5"]'); await sleep(100);
  let dims = await p.evaluate(() => [document.documentElement.scrollHeight, innerHeight]);
  check(dims[0] <= dims[1], 'risk screen fits 1366x768 after repeated taps (' + dims + ')');
  await sleep(1200); await p.reload(); await sleep(300);
  check(await step(p) === 'sa:TEC', 'mid-interview reload resumes at the same question');
  if (!(await until(async()=>true))) {} ; { const _s = await state(p); const _h = await h2(p); if (!(_s.step === 'sa:TEC' || _h === 'Saved.')) console.log('   DEBUG '+'mid-interview reload resumes at the same question'+': step=', _s.step, 'done=', !!_s.done, 'h2=', _h, 'url=', p.url(), 'errors=', p.errors.join('|')); }
  await p.click('.dot[data-r="SOC"]'); await sleep(60);
  dims = await p.evaluate(() => [document.documentElement.scrollHeight, innerHeight]);
  check(dims[0] <= dims[1], 'risk screen fits after reload');

  // responses panel
  await p.click('#toggle-results'); await sleep(150);
  check(await until(async () => (await p.$eval('#results h2', e => e.textContent)) === '3 responses'), 'panel counts 3 responses');
  check(await p.$$eval('#results tbody tr', r => r.length) >= 5, 'panel table has rows per technology');
  check(await p.$$eval('#results .ritem', r => r.length) === 3, 'panel lists 3 individual responses');
  await p.click('#csv'); await sleep(50);
  const dl = await p.evaluate(() => window.__downloads.slice(-1)[0]);
  const lines = dl ? dl.data.split('\n') : [];
  check(dl && dl.filename.endsWith('.csv'), 'CSV download offered');
  check(lines.length === 1 + (9+9+9) + 9 + (9+9+9), 'CSV has one row per rating and importance score (' + lines.length + ')');
  check(lines[0].startsWith('response_id,source,respondent_ref'), 'CSV header');
  const delBtn = await p.$('#results [data-del]');
  await delBtn.click(); await sleep(30);
  check((await p.$eval('#results [data-del]', e => e.textContent)).includes('again'), 'Delete needs a second tap');
  await p.click('#results [data-del]'); await sleep(150);
  check(await until(async () => (await p.$eval('#results h2', e => e.textContent)) === '2 responses'), 'delete removes one response');
  // panel open should not break the survey underneath
  await p.click('.cell[data-l="2"][data-i="2"]'); await sleep(330);
  check(p.errors.length === 0, 'no page errors in editor run: ' + p.errors.join(' | '));
  const editorStore = await store(p);
  await ctx.close();

  // ---------- S2: respondent (Contributor) on their own account
  console.log('S2 respondent account');
  ({ctx, page: p} = await newCtx(browser, 'resp', {seed: editorStore}));
  await sleep(200);
  check(!(await p.isVisible('#toggle-results')), 'Responses button hidden for respondent');
  await about(p, 2, 1, 'oae_min');
  await rateAll(p, 'sa', P9(3, 3)); await clickNext(p); await rateAll(p, 'int', P9(2, 2)); await clickNext(p);
  check(!(await p.$('#ref')), 'no reference field for respondent');
  await clickNext(p); await sleep(250);
  st = await store(p);
  check(st['responses/u_resp'] && st['responses/u_resp'].cat === 'oae_min' && st['responses/u_resp'].source === 'page', 'respondent saved under own record');
  console.log('   int records:', JSON.stringify(Object.keys(st)), 'editorStore:', JSON.stringify(Object.keys(editorStore))); check(Object.keys(st).filter(k => k.startsWith('responses/int-')).length === Object.keys(editorStore).filter(k => k.startsWith('responses/int-')).length, 'respondent did not touch interview records');
  check((await h2(p)) === 'Thank you. Your answers are saved.', 'respondent thank-you screen');
  await p.evaluate(() => localStorage.removeItem('cdr-risk-survey-v4')); await sleep(1200); await p.reload(); await sleep(300);
  check(await until(async () => (await h2(p)) === 'Thank you. Your answers are saved.'), 'respondent sees saved response after clearing browser draft (restored from record)');
  if ((await h2(p)) !== 'Thank you. Your answers are saved.') console.log('   DEBUG h2=', await h2(p), 'state=', await p.evaluate(() => localStorage.getItem('cdr-risk-survey-v4')), 'rec=', JSON.stringify((await store(p))['responses/u_resp']).slice(0,200));
  await p.click('[data-redo="sa"]'); await sleep(60); await rateAll(p, 'sa', P9(5, 5));
  await clickNext(p); for (let k = 0; k < 9; k++) await p.click('.dot[data-r="SOC"]').catch(()=>{});
  await p.click('#next'); await sleep(60); // from int:SOC to rank
  await clickNext(p); await clickNext(p); await sleep(250);
  st = await store(p);
  check(st['responses/u_resp'].ratings.sa.TEC[0] === 5 && Object.keys(st).filter(k => k === 'responses/u_resp').length === 1, 'respondent edit overwrites own record');
  check(p.errors.length === 0, 'no page errors in respondent run: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S3: no runtime (e.g. signed-out public visitor)
  console.log('S3 no runtime');
  ({ctx, page: p} = await newCtx(browser, 'none'));
  await about(p, 0, 4, 'erw');
  await rateAll(p, 'sa', P9(2, 2)); await clickNext(p); await rateAll(p, 'int', P9(2, 2)); await clickNext(p); await clickNext(p); await sleep(200);
  check(await until(async () => (await h2(p)) === 'Thank you. Your answers are saved.'), 'saved via Google Form when no claude.ai runtime');
  check(p.posts.length === 1, 'exactly one form POST (' + p.posts.length + ')');
  const form = new URLSearchParams(p.posts[0] || '');
  const code = form.get('entry.269220021') || '';
  check(code.startsWith('CDRRISK2.'), 'form POST carries the answer code');
  check((form.get('entry.530102048') || '') === 'Enhanced rock weathering + Rock weathering sold to farmers', 'form POST carries the technology label: ' + form.get('entry.530102048'));
  const sent = JSON.parse(Buffer.from(code.slice(9), 'base64').toString('utf8'));
  check(sent.cat === 'erw' && Object.keys(sent.ratings.sa).length === 9 && Object.keys(sent.ratings.int).length === 9 && sent.rid, 'decoded form payload is complete');
  check(await p.$eval('#bk', e => e.value) === code, 'backup code matches what was sent');
  check(p.errors.length === 0, 'no page errors without runtime: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S3b: form unreachable -> email fallback
  console.log('S3b form unreachable');
  ({ctx, page: p} = await newCtx(browser, 'none'));
  await p.unroute(/docs\.google\.com\/forms/); await p.route(/docs\.google\.com\/forms/, r => {}); // never answers
  await about(p, 0, 0, 'ccs_pow'); for (let k = 0; k < 9; k++) { await p.click('.cell[data-l="2"][data-i="2"]'); await sleep(330); }
  await clickNext(p); await clickNext(p);
  check(await until(async () => (await h2(p)) === 'One last step: send your answers', 16000), 'email fallback when the form cannot be reached');
  check((await p.$eval('#code', e => e.value)).startsWith('CDRRISK2.'), 'fallback shows answer code');
  check(p.errors.length === 0, 'no page errors in fallback: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S7: interview mode on the public page (#interview), three people in a row
  console.log('S7 interview mode via #interview');
  ({ctx, page: p} = await newCtx(browser, 'none'));
  await p.goto(PAGE + '#interview'); await sleep(200);
  const rids = [];
  for (const [n, catId, ref] of [[0,'dac_ss','A1'],[1,'ccs_ind','A2'],[2,'oae_min','A3']]) {
    await about(p, n, n, catId);
    for (let k = 0; k < 20 && (await step(p)) !== 'rank'; k++) { if (await p.$('.cell')) { await p.click('.cell[data-l="3"][data-i="2"]'); await sleep(330); } else await clickNext(p); }
    await clickNext(p);
    check(await p.isVisible('#ref'), 'reference field shown in interview mode');
    await p.fill('#ref', ref); await clickNext(p);
    check(await until(async () => (await h2(p)) === 'Saved.'), 'interview saved screen for ' + ref);
    const f = new URLSearchParams(p.posts[p.posts.length - 1]);
    const o = JSON.parse(Buffer.from(f.get('entry.269220021').slice(9), 'base64').toString('utf8'));
    check(o.ref === ref && o.mode === 'interview' && f.get('entry.530102048').includes('[' + ref + ']'), 'form row carries reference ' + ref);
    rids.push(o.rid);
    await p.click('#nextresp'); await sleep(80);
    check((await state(p)).cat === null && !(await state(p)).rid, 'blank form for the next person');
  }
  check(p.posts.length === 3 && new Set(rids).size === 3, 'three interviews -> three form rows with distinct response IDs');
  check(p.errors.length === 0, 'no page errors in interview mode: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S4: editor imports that code (twice) — duplicates stored once
  console.log('S4 import codes');
  ({ctx, page: p} = await newCtx(browser, 'editor', {seed: editorStore}));
  await sleep(250);
  await p.click('#toggle-results'); await sleep(150);
  await p.fill('#imp', code + '\n' + code + '\nnot-a-code');
  await p.click('#imp-btn'); await sleep(300);
  st = await store(p);
  check(Object.keys(st).filter(k => k.startsWith('responses/code-')).length === 1, 'same code twice stored once');
  check(await until(async () => (await p.$eval('#results h2', e => e.textContent)) === '3 responses'), 'panel updates after import');
  if ((await p.$eval('#results h2', e => e.textContent)) !== '3 responses') console.log('   DEBUG import: h2=', await p.$eval('#results h2', e => e.textContent), 'store=', JSON.stringify(Object.keys(await store(p))), 'status=', await p.$eval('#rs', e => e.textContent));
  check(p.errors.length === 0, 'no page errors in import run: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S5: stale browser state from an older version
  console.log('S5 stale state');
  ({ctx, page: p} = await newCtx(browser, 'editor'));
  await p.evaluate(() => localStorage.setItem('cdr-risk-survey-v4', JSON.stringify({step:'sa:TEC', cat:'min', ratings:{sa:{},int:{}}})));
  await p.reload(); await sleep(250);
  check(await p.isVisible('#exp0'), 'unknown technology in saved state falls back to the first question');
  check(p.errors.length === 0, 'no page errors with stale state: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S6: phone width
  console.log('S6 phone');
  ({ctx, page: p} = await newCtx(browser, 'editor', {viewport:{width:390, height:844}}));
  await about(p, 1, 1, 'beccs');
  const pw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(pw[0] <= pw[1], 'no sideways scroll on phone (' + pw + ')');
  const cellBox = await p.$eval('.cell', e => e.getBoundingClientRect().width);
  check(cellBox >= 40, 'grid squares stay tappable on phone (' + Math.round(cellBox) + 'px)');
  await rateAll(p, 'sa', P9(3, 3)); await clickNext(p); await rateAll(p, 'int', P9(3, 3));
  const rw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(rw[0] <= rw[1], 'last question has no sideways scroll on phone');
  await p.screenshot({path: path.join(__dirname, 'phone-rank.png')});
  check(p.errors.length === 0, 'no page errors on phone: ' + p.errors.join(' | '));
  await ctx.close();

  await browser.close();
  console.log(`\n${passes} checks passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
