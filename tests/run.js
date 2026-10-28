// End-to-end click tests for the survey page (v5 flow) against a mocked claude.ai runtime.
// Flow: intro + consent -> 3 background questions -> "what happens next" -> part 1 risks -> part 1 importance
//       -> [part 2 intro -> part 2 risks -> part 2 importance] -> review -> thank-you screen (interview offer).
const { chromium } = require('playwright');
const path = require('path');
const PAGE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const MOCK = require('fs').readFileSync(path.join(__dirname, 'mock.js'), 'utf8');
const KEY = 'cdr-risk-survey-v5';
const ORDER = ['TEC','PRI','POL','CUR','CON','CPT','PER','SOC','CER'];
const TITLES = ['Technology risk','Price risk','Policy risk','Transport and storage risk','Cost risk','Counterparty risk','Regulatory risk','Acceptance risk','Certification risk'];
let fails = 0, passes = 0;
function check(c, msg){ if (c) { passes++; } else { fails++; console.log('  FAIL: ' + msg); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 3000){ const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) {} await sleep(40); } return false; }

async function newCtx(browser, role, opts = {}){
  const ctx = await browser.newContext({viewport: opts.viewport || {width:1366, height:768}});
  ctx.db = {text: opts.seed ? JSON.stringify(opts.seed) : '{}'};
  await ctx.exposeFunction('__dbget', () => ctx.db.text);
  await ctx.exposeFunction('__dbput', s => { ctx.db.text = s; });
  await ctx.addInitScript(([r, u]) => { localStorage.setItem('__role', r); if (u) localStorage.setItem('__uid', u); }, [role, opts.uid || '']);
  await ctx.addInitScript(MOCK);
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
const state = p => p.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}'), KEY);
const step = async p => (await state(p)).step;
const store = p => Promise.resolve(JSON.parse(p.context().db.text || '{}'));
const h2 = p => p.$eval('#app h2', e => e.textContent).catch(() => '');
const appText = p => p.$eval('#app', e => e.textContent).catch(() => '');
async function clickNext(p){ await p.click('#next'); await sleep(60); }
async function rateAll(p, scn, picks){ // picks: array of [L,I] or 'ns', length 9, in ORDER
  for (let i = 0; i < 9; i++) {
    const before = await step(p);
    check(before === scn + ':' + ORDER[i], `expected ${scn}:${ORDER[i]}, got ${before}`);
    const v = picks[i];
    if (v === 'ns') { await p.click('#ns'); await sleep(60); }
    else { await p.click(`.cell[data-l="${v[0]}"][data-i="${v[1]}"]`); await sleep(330); }
  }
}
async function intro(p){
  check(await step(p) === undefined || await step(p) === 'intro', 'starts on the intro page (' + await step(p) + ')');
  check(await p.$eval('#next', b => b.disabled), 'Start survey disabled before consent');
  await p.check('#consent'); await sleep(30);
  check(!(await p.$eval('#next', b => b.disabled)), 'Start survey enabled after consent');
  await clickNext(p);
}
async function about(p, exp, sector, cat){
  const s0 = await step(p);
  if (s0 === undefined || s0 === 'intro') await intro(p);
  if (await step(p) === 'q1') {
    await p.click('#exp' + exp); await sleep(300);
    check(await step(p) === 'q2', 'auto-advance q1 -> q2');
    await p.click('#sector' + sector); await sleep(300);
  }
  check(await step(p) === 'q3', 'technology question reached');
  await p.click('#c-' + cat); await sleep(50);
  check(await p.$eval('#next', b => !b.disabled), 'Next enabled after picking a technology');
  await clickNext(p);
  check(await step(p) === 'plan', 'explanation screen after choosing a technology');
  await clickNext(p);
}
const P9 = (L, I) => Array(9).fill([L, I]);
async function riskScreenChecks(p, label){
  const t = await p.$eval('.qblock .tag', e => e.textContent);
  check(TITLES.includes(t), label + ': risk title shown (' + t + ')');
  const txt = await appText(p);
  check(!/on its own/.test(txt), label + ': no "on its own" in the risk screen');
  check(!/revenue is lost/.test(txt), label + ': impact axis sentence removed');
}

(async () => {
  const browser = await chromium.launch();
  let s, st, ids;

  // ---------- S0: intro page and privacy notice
  console.log('S0 intro and privacy notice');
  let {ctx, page: p} = await newCtx(browser, 'none');
  check(await p.isVisible('#consent'), 'consent box on the first page');
  check((await appText(p)).includes('Heriot-Watt') && (await appText(p)).includes('minutes'), 'intro names the team and the time needed');
  await p.keyboard.press('ArrowRight'); await sleep(60);
  check(await step(p) === undefined || await step(p) === 'intro', 'ArrowRight does not pass the consent page');
  await p.click('#pn'); await sleep(60);
  check(await p.isVisible('#notice'), 'privacy notice opens');
  check((await p.$eval('#notice', e => e.textContent)).includes('Data Protection Officer'), 'notice gives the Data Protection Officer');
  await p.keyboard.press('Escape'); await sleep(40);
  check(!(await p.isVisible('#notice')), 'Escape closes the notice');
  await p.click('#pn'); await sleep(40); await p.click('#nclose'); await sleep(40);
  check(!(await p.isVisible('#notice')), 'Close button closes the notice');
  await p.check('#consent'); await sleep(30);
  check(!!(await state(p)).consentAt, 'consent time recorded');
  await p.uncheck('#consent'); await sleep(30);
  check(await p.$eval('#next', b => b.disabled), 'unticking consent disables Start again');
  check(p.errors.length === 0, 'no page errors on intro: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S1: editor interview, paired technology, navigation detours
  console.log('S1 editor interview (DAC solid sorbent, paired)');
  ({ctx, page: p} = await newCtx(browser, 'editor'));
  await sleep(150);
  check(await p.isVisible('#toggle-results'), 'Responses button visible to editor');
  await about(p, 1, 2, 'dac_ss');
  check(await step(p) === 'sa:TEC', 'lands on part 1 first risk');
  await riskScreenChecks(p, 'part 1');
  check((await p.$eval('.tag.part', e => e.textContent)) === 'Part 1 · DAC: solid sorbent', 'part 1 label is the technology name');
  check(await p.$$eval('.dot', d => d.map(x => x.textContent).join(',')) === 'TECH,PRICE,POL,T&S,COST,CPTY,REG,ACC,CERT', 'risk shortcuts in the agreed order');
  await p.click('.cell[data-l="4"][data-i="3"]'); await sleep(330);
  check(await step(p) === 'sa:PRI', 'auto-advance after first rating');
  await p.click('#back'); await sleep(60);
  check(await step(p) === 'sa:TEC', 'Back returns to TEC');
  check(await p.$eval('.cell[data-l="4"][data-i="3"]', e => e.classList.contains('picked')), 'previous answer shown as picked');
  await p.click('.cell[data-l="2"][data-i="2"]'); await sleep(400);
  check(await step(p) === 'sa:TEC', 'changing an existing answer does not auto-advance');
  check(JSON.stringify((await state(p)).ratings.sa.TEC) === '[2,2]', 'changed answer stored');
  await p.click('.dot[data-r="CUR"]'); await sleep(60);
  check(await step(p) === 'sa:CUR' && (await p.$eval('.qblock .tag', e => e.textContent)) === 'Transport and storage risk', 'risk shortcut jumps to transport and storage');
  await p.click('#back'); await p.click('#back'); await p.click('#back'); await p.click('#back'); await sleep(60);
  check(await step(p) === 'plan', 'Back from the first risk returns to the explanation screen');
  check((await appText(p)).includes('What we mean by co-benefits'), 'explanation screen defines co-benefits');
  await ctx.close();

  // ---------- S1 (clean run): editor completes three interviews
  ({ctx, page: p} = await newCtx(browser, 'editor'));
  await sleep(150);
  await about(p, 1, 2, 'dac_ss');
  await rateAll(p, 'sa', [[4,3],[3,3],'ns',[2,4],[3,2],[4,4],[1,3],[2,2],[5,5]]);
  check(await step(p) === 'wsa', 'part 1 importance after part 1 risks');
  check((await h2(p)).includes('stand-alone DAC: solid sorbent'), 'part 1 importance names the stand-alone project');
  check(await p.$$eval('.wn', e => e.map(x => x.textContent).join('|')) === TITLES.join('|'), 'importance rows use the risk titles');
  await p.fill('#w-TEC', '9'); await clickNext(p);
  check(await step(p) === 'int', 'after part 1 importance the integration intro appears');
  check((await h2(p)) === 'DAC at a data centre', 'integration title shown');
  check(await p.$$eval('.kind', els => els.map(e => e.textContent).join(',')) === 'Co-location,Co-product', 'integration type labels shown');
  await p.keyboard.press('ArrowRight'); await sleep(60);
  check(await step(p) === 'int:TEC', 'ArrowRight presses Start on the intro');
  await riskScreenChecks(p, 'part 2');
  check(await p.$$eval('#app .cell span', els => els.length) === 0, 'part 2 grid shows no part 1 labels');
  await p.click('.cell[data-l="3"][data-i="3"]'); await sleep(330);
  check(await step(p) === 'int:PRI', 'part 2 advances to second risk');
  for (const v of [[3,3],[3,2],[2,4],[4,3],[3,3],[2,3],[2,2],[4,4]]) { await p.click(`.cell[data-l="${v[0]}"][data-i="${v[1]}"]`); await sleep(330); }
  check(await step(p) === 'wint', 'part 2 importance after part 2 risks');
  check((await h2(p)).includes('co-benefits'), 'part 2 importance names the version with co-benefits');
  await p.click('.info[data-i="CUR"]'); await sleep(30);
  check(await p.isVisible('#d-CUR'), 'info opens definition');
  await p.click('.info[data-i="TEC"]'); await sleep(30);
  check(!(await p.isVisible('#d-CUR')) && await p.isVisible('#d-TEC'), 'only one definition open at a time');
  await p.click('.info[data-i="TEC"]'); await sleep(30);
  check(!(await p.isVisible('#d-TEC')), 'info closes on second click');
  await p.fill('#w-PRI', '2');
  check(await p.$eval('#wv-PRI', e => e.textContent) === '2', 'slider value label updates');
  await p.click('#back'); await sleep(60);
  check(await step(p) === 'int:CER', 'Back from part 2 importance goes to last risk');
  await clickNext(p);
  check(await p.$eval('#w-PRI', e => e.value) === '2', 'slider values kept after Back/Next');
  await p.focus('body'); await p.keyboard.press('ArrowRight'); await sleep(60);
  check(await step(p) === 'review', 'ArrowRight leaves the last importance question');
  s = await state(p);
  check(s.rankDone.sa && s.rankDone.int && s.weights.sa.TEC === 9 && s.weights.int.PRI === 2 && s.weights.int.SOC === 5, 'both importance sets saved');
  check(!(await p.$('#startover')) && !(await p.$('#change')) && !(await p.$('[data-redo]')), 'review has no Start over / Change technology / Redo buttons');
  check(await p.isVisible('#ref'), 'respondent reference field shown to editor');
  await p.fill('#ref', 'R1');
  await p.fill('#comment', 'test comment 1');
  await p.click('#next'); await p.click('#next').catch(()=>{}); await sleep(250);
  st = await store(p);
  ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 1, 'double-click on Submit stores exactly one record (got ' + ids.length + ')');
  const d1 = st[ids[0]];
  check(d1 && d1.v === 4 && d1.consent && d1.consent.given === true && d1.consent.at, 'record carries consent');
  check(d1 && d1.ref === 'R1' && d1.mode === 'interview' && d1.source === 'interview', 'record carries reference and interview mode');
  check(d1 && Object.keys(d1.ratings.sa).length === 9 && d1.ratings.sa.POL === 'ns' && Object.keys(d1.ratings.int).length === 9 && d1.ratings.sa.CER, 'record has 9 + 9 ratings with not-sure');
  check(d1 && !('RES' in d1.ratings.sa), 'removal estimate no longer asked');
  check(d1 && d1.weights.sa.TEC === 9 && d1.weights.int.PRI === 2 && d1.integration.model === 'DAC_DC' && d1.modelStandalone === 'DAC_SS', 'record has both importance sets and model links');
  check(d1 && d1.comment === 'test comment 1' && d1.exp === '2–5 years' && d1.sector === 'Academia or research', 'record has comment and background');
  check((await h2(p)) === 'Saved.', 'editor sees Saved.');
  check(await p.isVisible('#nextresp'), 'Start next response button shown');
  await p.click('[data-redo="wint"]'); await sleep(60);
  check(await step(p) === 'wint', 'Redo part 2 importance opens that question');
  await p.fill('#w-SOC', '10'); await clickNext(p); await clickNext(p); await sleep(250);
  st = await store(p); ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 1 && st[ids[0]].weights.int.SOC === 10 && st[ids[0]].weights.sa.TEC === 9, 'correction overwrites the same record');
  await sleep(1200); await p.reload(); await sleep(300);
  check(await until(async () => (await h2(p)) === 'Saved.'), 'done screen survives reload');
  await p.click('#nextresp'); await sleep(60);
  s = await state(p);
  check(s.step === 'intro' && !s.consent && s.exp === null && s.cat === null && !s.docId && !s.ref, 'Start next response gives a blank form starting at consent');

  // interview 2: unpaired technology, skip importance, rapid clicks
  await intro(p);
  await p.click('#exp0'); await p.click('#next'); await sleep(400);
  check(await step(p) === 'q2', 'quick select + Next does not skip a question (q2)');
  await p.click('#sector0'); await p.click('#next'); await sleep(400);
  check(await step(p) === 'q3', 'quick select + Next does not skip a question (q3)');
  await p.click('#c-ccs_eor'); await clickNext(p);
  check(await step(p) === 'plan' && !(await appText(p)).includes('What we mean by co-benefits'), 'one-part explanation for unpaired technology');
  await clickNext(p);
  check((await p.$eval('.tag.part', e => e.textContent)) === 'CCS: enhanced oil recovery', 'unpaired label is just the technology name');
  await p.click('.cell[data-l="3"][data-i="3"]'); await p.click('#next'); await sleep(400);
  check(await step(p) === 'sa:PRI', 'tap + immediate Next advances exactly one risk');
  for (let k = 0; k < 12 && (await step(p)).startsWith('sa:'); k++) { await p.click('.cell[data-l="2"][data-i="3"]'); await sleep(330); }
  check(await step(p) === 'wsa', 'unpaired technology goes to its importance question');
  await p.click('#wskip'); await sleep(60);
  check(await step(p) === 'review', 'Skip goes to review');
  check((await appText(p)).includes('Part 1: 9 of 9') && !(await appText(p)).includes('Part 2'), 'review summary for unpaired technology');
  await p.fill('#ref', 'R2'); await clickNext(p); await sleep(250);
  st = await store(p); ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 2, 'second interview stored as a separate record');
  const d2 = ids.map(k => st[k]).find(x => x.ref === 'R2');
  check(d2 && d2.weights.sa === null && d2.weights.int === null && d2.integration === null && d2.cat === 'ccs_eor', 'unpaired record has no integration or importance');
  await p.click('#nextresp'); await sleep(60);

  // interview 3: change technology part-way, redo part 2 after saving
  await about(p, 3, 0, 'dac_ss');
  await p.click('.cell[data-l="2"][data-i="2"]'); await sleep(330);
  for (let k = 0; k < 3; k++) await p.click('#back');
  await sleep(60);
  check(await step(p) === 'q3', 'Back reaches technology question');
  await p.click('#c-cew'); await clickNext(p); await clickNext(p);
  check(Object.keys((await state(p)).ratings.sa).length === 0, 'changing technology clears earlier ratings');
  await rateAll(p, 'sa', P9(3, 4)); await clickNext(p);
  check((await h2(p)) === 'Coastal weathering in beach nourishment', 'CEW integration intro');
  await clickNext(p);
  await rateAll(p, 'int', P9(2, 3));
  await clickNext(p); // accept default sliders
  check(await step(p) === 'review', 'review reached');
  await p.fill('#ref', 'R3'); await clickNext(p); await sleep(250);
  await p.click('[data-redo="int"]'); await sleep(60);
  check(await step(p) === 'int', 'Redo part 2 opens the integration intro');
  check(Object.keys((await state(p)).ratings.int).length === 0 && Object.keys((await state(p)).ratings.sa).length === 9, 'Redo part 2 cleared part 2 only');
  await clickNext(p); await rateAll(p, 'int', P9(1, 2)); await clickNext(p);
  await clickNext(p); await sleep(250);
  st = await store(p); ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 3, 'three interviews stored (correction overwrote R3)');

  // fit-to-screen on a risk screen after re-renders
  await p.click('#nextresp'); await about(p, 0, 0, 'biochar');
  await p.click('.cell[data-l="3"][data-i="3"]'); await sleep(330); await p.click('#back'); await sleep(60);
  await p.click('.cell[data-l="4"][data-i="4"]'); await sleep(100); await p.click('.cell[data-l="5"][data-i="5"]'); await sleep(100);
  let dims = await p.evaluate(() => [document.documentElement.scrollHeight, innerHeight]);
  check(dims[0] <= dims[1], 'risk screen fits 1366x768 after repeated taps (' + dims + ')');
  await sleep(1200); await p.reload(); await sleep(300);
  check(await step(p) === 'sa:TEC', 'mid-interview reload resumes at the same question');
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
  check(lines.length === 1 + (18 + 9 + 18) + (18 + 0 + 18), 'CSV has one row per rating and importance score (' + lines.length + ')');
  check(lines.some(l => l.includes('importance integrated')), 'CSV separates part 2 importance');
  const delBtn = await p.$('#results [data-del]');
  await delBtn.click(); await sleep(30);
  check((await p.$eval('#results [data-del]', e => e.textContent)).includes('again'), 'Delete needs a second tap');
  await p.click('#results [data-del]'); await sleep(150);
  check(await until(async () => (await p.$eval('#results h2', e => e.textContent)) === '2 responses'), 'delete removes one response');
  await p.click('.cell[data-l="2"][data-i="2"]'); await sleep(330);
  check(p.errors.length === 0, 'no page errors in editor run: ' + p.errors.join(' | '));
  const editorStore = await store(p);
  await ctx.close();

  // ---------- S2: respondent (Contributor) on their own claude.ai account
  console.log('S2 respondent account');
  ({ctx, page: p} = await newCtx(browser, 'resp', {seed: editorStore}));
  await sleep(200);
  check(!(await p.isVisible('#toggle-results')), 'Responses button hidden for respondent');
  await about(p, 2, 1, 'oae_min');
  await rateAll(p, 'sa', P9(3, 3)); await clickNext(p); await clickNext(p); await rateAll(p, 'int', P9(2, 2)); await clickNext(p);
  check(!(await p.$('#ref')), 'no reference field for respondent');
  await clickNext(p); await sleep(250);
  st = await store(p);
  check(st['responses/u_resp'] && st['responses/u_resp'].cat === 'oae_min' && st['responses/u_resp'].source === 'page', 'respondent saved under own record');
  check(Object.keys(st).filter(k => k.startsWith('responses/int-')).length === Object.keys(editorStore).filter(k => k.startsWith('responses/int-')).length, 'respondent did not touch interview records');
  check((await h2(p)) === 'Thank you for your time!', 'respondent thank-you screen');
  check(await p.isVisible('#iv1') && await p.isVisible('#another') && !(await p.$('#startover')) && !(await p.$('#change')), 'thank-you screen: interview offer and Evaluate another technology only');
  await p.evaluate(k => localStorage.removeItem(k), KEY); await sleep(1200); await p.reload(); await sleep(300);
  check(await until(async () => (await h2(p)) === 'Thank you for your time!'), 'respondent sees saved response after clearing browser draft (restored from record)');
  await p.click('#another'); await sleep(60);
  s = await state(p);
  check(s.step === 'q3' && s.exp === 2 && s.sector === 1 && s.consent && s.cat === null && !s.done && !s.rid, 'Evaluate another technology keeps background and consent, clears the rest');
  check(s.activeMs < 1500 && Object.keys(s.stepMs || {}).length <= 1 && Date.now() - Date.parse(s.startedAt) < 3000, 'Evaluate another technology restarts the timer');
  check(p.errors.length === 0, 'no page errors in respondent run: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S3: no runtime (public page) -> Google Form; interview offer
  console.log('S3 public page');
  ({ctx, page: p} = await newCtx(browser, 'none'));
  await about(p, 0, 4, 'erw');
  await rateAll(p, 'sa', P9(2, 2)); await clickNext(p); await clickNext(p); await rateAll(p, 'int', P9(2, 2)); await clickNext(p); await clickNext(p); await sleep(200);
  check(await until(async () => (await h2(p)) === 'Thank you for your time!'), 'saved via Google Form when no claude.ai runtime');
  check(p.posts.length === 1, 'exactly one form POST (' + p.posts.length + ')');
  const form = new URLSearchParams(p.posts[0] || '');
  const code = form.get('entry.269220021') || '';
  check(code.startsWith('CDRRISK2.'), 'form POST carries the answer code');
  const cols = (form.get('entry.530102048') || '').split('|'); const hdr = await p.evaluate(() => window.__tableHeader);
  check(cols.length === hdr.length && hdr.length === 69, 'table record has one value per header column (' + cols.length + '/' + hdr.length + ')');
  check(cols[0] === 'R3' && cols[7] === 'Enhanced rock weathering' && cols[8] === 'Rock weathering sold to farmers', 'table record names technology and integration');
  check(cols[hdr.indexOf('P1 Technology risk likelihood')] === '2' && cols[hdr.indexOf('P2 Acceptance risk impact')] === '2' && cols[hdr.indexOf('P1 importance Policy risk')] === '5' && cols[hdr.indexOf('P2 importance Certification risk')] === '5', 'table record values in the right columns');
  check(!!cols[hdr.indexOf('consent_at')], 'table record carries consent time');
  check(hdr.indexOf('comment') === 64 && hdr.slice(65).join() === 'started_at,total_seconds,active_seconds,seconds_per_screen', 'timing columns appended after the R2 columns');
  const tStart = cols[hdr.indexOf('started_at')], tTot = +cols[hdr.indexOf('total_seconds')], tAct = +cols[hdr.indexOf('active_seconds')], tScr = cols[hdr.indexOf('seconds_per_screen')];
  check(!isNaN(Date.parse(tStart)) && Date.parse(tStart) <= Date.parse(cols[1]), 'started_at is a time before submission (' + tStart + ')');
  check(tTot >= 1 && tAct >= 1 && tAct <= tTot + 1, 'total and active seconds recorded (' + tTot + ' / ' + tAct + ')');
  check(/^intro=\d+;q1=\d+;/.test(tScr) && tScr.includes('sa:TEC=') && tScr.includes('int:CER=') && tScr.includes('review='), 'seconds per screen recorded in survey order (' + tScr.slice(0, 60) + '…)');
  const sent = JSON.parse(Buffer.from(code.slice(9), 'base64').toString('utf8'));
  check(sent.v === 4 && sent.timing && sent.timing.totalS === tTot && sent.timing.steps.intro >= 0 && sent.cat === 'erw' && Object.keys(sent.ratings.sa).length === 9 && Object.keys(sent.ratings.int).length === 9 && sent.rid && sent.consent.given, 'decoded form payload is complete');
  check(await p.$eval('#bk', e => e.value) === code, 'backup code matches what was sent');
  // interview offer
  await p.click('#iv1'); await sleep(40);
  check(await p.isVisible('#ivn'), 'Yes shows the contact fields');
  await p.fill('#ivn', 'Test Person'); await p.fill('#ivo', 'Test Org'); await p.fill('#ive', 'not-an-email');
  await p.click('#ivsend'); await sleep(60);
  check((await p.$eval('#iverr', e => e.textContent)).length > 0 && p.posts.length === 1, 'invalid email is not sent');
  await p.fill('#ive', 'test@example.org'); await p.click('#ivsend'); await sleep(300);
  check(p.posts.length === 2, 'contact details sent as a second form row');
  const cf = new URLSearchParams(p.posts[1] || '');
  check(cf.get('entry.269220021') === 'CONTACT|' + sent.rid && cf.get('entry.530102048').split('|').slice(3).join('|') === 'Test Person|Test Org|test@example.org', 'contact row linked by response number');
  check((await appText(p)).includes('We will contact you'), 'contact confirmation shown');
  await p.click('#another'); await sleep(60);
  check(await step(p) === 'q3', 'Evaluate another technology returns to the technology question');
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
  check(await p.isVisible('#another'), 'fallback offers Evaluate another technology');
  check(p.errors.length === 0, 'no page errors in fallback: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S7: interview mode on the public page (#interview), three people in a row
  console.log('S7 interview mode via #interview');
  ({ctx, page: p} = await newCtx(browser, 'none'));
  await p.goto(PAGE + '#interview'); await sleep(200);
  const rids = [];
  for (const [n, catId, ref] of [[0,'dac_ss','A1'],[1,'ccs_ind','A2'],[2,'oae_min','A3']]) {
    await about(p, n, n, catId);
    for (let k = 0; k < 30 && (await step(p)) !== 'review'; k++) { if (await p.$('.cell')) { await p.click('.cell[data-l="3"][data-i="2"]'); await sleep(330); } else await clickNext(p); }
    check(await p.isVisible('#ref'), 'reference field shown in interview mode');
    await p.fill('#ref', ref); await clickNext(p);
    check(await until(async () => (await h2(p)) === 'Saved.'), 'interview saved screen for ' + ref);
    const f = new URLSearchParams(p.posts[p.posts.length - 1]);
    const o = JSON.parse(Buffer.from(f.get('entry.269220021').slice(9), 'base64').toString('utf8'));
    check(o.ref === ref && o.mode === 'interview' && f.get('entry.530102048').split('|')[3] === ref, 'form row carries reference ' + ref);
    rids.push(o.rid);
    await p.click('#nextresp'); await sleep(80);
    check((await state(p)).cat === null && !(await state(p)).rid && (await state(p)).step === 'intro', 'blank form for the next person');
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
  check(p.errors.length === 0, 'no page errors in import run: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S5: stale browser state
  console.log('S5 stale state');
  ({ctx, page: p} = await newCtx(browser, 'editor'));
  await p.evaluate(k => localStorage.setItem(k, JSON.stringify({step:'sa:TEC', cat:'min', ratings:{sa:{},int:{}}})), KEY);
  await p.reload(); await sleep(250);
  check(await p.isVisible('#consent'), 'unknown technology in saved state falls back to the intro');
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
  await rateAll(p, 'sa', P9(3, 3)); await clickNext(p); await clickNext(p); await rateAll(p, 'int', P9(3, 3));
  const rw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(rw[0] <= rw[1], 'importance question has no sideways scroll on phone');
  await p.screenshot({path: path.join(__dirname, 'phone-rank.png')});
  check(p.errors.length === 0, 'no page errors on phone: ' + p.errors.join(' | '));
  await ctx.close();

  await browser.close();
  console.log(`\n${passes} checks passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
