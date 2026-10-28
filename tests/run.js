// End-to-end click tests for the survey page (v9 flow) against a mocked claude.ai runtime.
// Flow: intro + consent -> 3 background questions -> "what happens next" -> baseline: part card -> one page of 7 coloured
//       0–10 sliders ("How large do you think each risk is?") -> importance;
//       then one variant (co-product or co-host; a technology with both gets one at random): part card -> one comparison page
//       (7 sliders, much lower … much higher than the baseline) -> importance -> review -> thank-you screen (interview offer).
//       The variant can be skipped on its card. Contexts can fix Math.random (opts.random) to choose the variant.
const { chromium, devices } = require('playwright');
const path = require('path');
// Serve the page over local http: with file:// URLs headless Chromium sometimes loses localStorage on reload.
const http = require('http'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, {'Content-Type': /\.html$/.test(file) ? 'text/html; charset=utf-8' : /\.js$/.test(file) ? 'text/javascript' : 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
const listening = new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
let PAGE;
const MOCK = require('fs').readFileSync(path.join(__dirname, 'mock.js'), 'utf8');
const KEY = 'cdr-risk-survey-v10';
const ORDER = ['TEC','PRI','POL','CUR','CON','CPT','SOC'];
const TITLES = ['Technology risk','Price risk','Policy risk','Supply chain risk','Cost risk','Counterparty risk','Permitting and acceptance risk'];
const NR = ORDER.length;
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
  if (opts.random != null) await ctx.addInitScript(r => { Math.random = () => r; }, opts.random);
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
// Baseline page: vals = rating per risk in ORDER, 0 (negligible) … 10 (severe) or 'ns' (Not sure); then Next.
async function rateBaseline(p, vals){
  check(vals.length === NR, 'rateBaseline given ' + NR + ' values');
  check(await step(p) === 'sa:rate', `expected sa:rate, got ${await step(p)}`);
  for (let i = 0; i < NR; i++) {
    if (vals[i] === 'ns') await p.click('.nsb[data-n="' + ORDER[i] + '"]');
    else await p.fill('#b-' + ORDER[i], String(vals[i]));
  }
  await sleep(30); await clickNext(p);
}
async function intro(p){
  check(await step(p) === undefined || await step(p) === 'intro', 'starts on the intro page (' + await step(p) + ')');
  check(await p.$eval('#next', b => b.disabled), 'Start survey disabled before consent');
  await p.check('#consent'); await sleep(30);
  check(!(await p.$eval('#next', b => b.disabled)), 'Start survey enabled after consent');
  await clickNext(p);
}
// From any start up to the baseline rating page (sa:rate).
async function about(p, exp, sector, cat, rank){
  const s0 = await step(p);
  if (s0 === undefined || s0 === 'intro') await intro(p);
  if (await step(p) === 'q1') {
    await p.click('#exp' + exp); await sleep(300);
    check(await step(p) === 'q2', 'auto-advance q1 -> q2');
    await p.click('#sector' + sector); await sleep(60);
    check(await step(p) === 'q2', 'choosing a workplace does not auto-advance (up to two answers)');
    await clickNext(p);
    check(await step(p) === 'rank', 'technology risk ranking after the background questions');
    for (const t of rank || []) { await p.click('.trk[data-t="' + t + '"]'); await sleep(30); }
    await clickNext(p);
  }
  check(await step(p) === 'q3', 'technology question reached');
  await p.click('#c-' + cat); await sleep(50);
  check(await p.$eval('#next', b => !b.disabled), 'Next enabled after picking a technology');
  await clickNext(p);
  check(await step(p) === 'plan', 'explanation screen after choosing a technology');
  await clickNext(p);
  check(await step(p) === 'sa', 'baseline card after the explanation screen');
  check((await appText(p)).includes('Revenue'), 'baseline card states the revenue');
  await clickNext(p);
}
const B7 = x => Array(NR).fill(x);
const C7 = x => Array(NR).fill(x);
// Comparison page of a co-product / co-host part: vals = change per risk in ORDER, -2 (much lower) … +2 (much higher).
async function compareAll(p, scn, vals){
  check(await step(p) === scn + ':cmp', `expected ${scn}:cmp, got ${await step(p)}`);
  for (let i = 0; i < NR; i++) await p.fill('#c-' + ORDER[i], String(vals[i] + 3));
  await sleep(30); await clickNext(p);
}
// Baseline page: heading, one coloured 0–10 slider per risk (Not set until touched), examples, definitions, Not sure.
async function baselineChecks(p, label){
  check((await h2(p)) === 'How large do you think each risk is?', label + ': question wording');
  check(await p.$$eval('.brow .cn', e => e.map(x => x.textContent).join('|')) === TITLES.join('|'), label + ': one slider row per risk, in the agreed order');
  check(await p.$eval('.bscale', e => e.textContent) === '0 · Negligible5 · Moderate10 · Severe', label + ': scale reads 0 negligible, 5 moderate, 10 severe');
  check(await p.$$eval('input.bsl', e => e.length === 7 && e.every(x => x.min === '0' && x.max === '10' && x.step === '1' && x.value === '5' && x.classList.contains('unset'))), label + ': 7 eleven-point sliders (0–10), unset, thumb at the middle');
  check(await p.$$eval('.bv', e => e.every(x => x.textContent === 'Not set')), label + ': sliders read Not set before they are touched');
  check(await p.$$eval('.brow .bex span', e => e.length === 7 && e.every(x => /^e\.g\., /.test(x.textContent))), label + ': every risk shows its example, written with "e.g.,"');
  check(await p.evaluate(() => [...document.styleSheets].some(sh => { let rs = []; try { rs = [...sh.cssRules]; } catch (e) {} return rs.some(r => /\.bsl::-webkit-slider-runnable-track/.test(r.selectorText || '') && /linear-gradient\(90deg,\s*var\(--s-lo\),\s*var\(--s-mid\),\s*var\(--s-hi\)\)/.test((r.style.backgroundImage || '') + (r.style.background || ''))); })), label + ': slider track is coloured (green to amber to red)');
  check(await p.$eval('#b-TEC', e => /grayscale/.test(getComputedStyle(e).filter)), label + ': unset slider is greyed');
  check(!(await p.$('.cell')) && !(await p.$('.matrix')) && !(await p.$('#ns')), label + ': no likelihood/impact grid');
  check(!/Likelihood|Impact/.test(await appText(p)), label + ': no likelihood or impact axis');
  check(!(await p.isVisible('#d-TEC')), label + ': definition hidden by default');
  await p.click('.info[data-i="TEC"]'); await sleep(30);
  check(await p.isVisible('#d-TEC') && (await p.$eval('#d-TEC', e => e.textContent)).includes('certifier'), label + ': i button shows the definition (technology risk covers certification)');
  await p.click('.info[data-i="SOC"]'); await sleep(30);
  check(!(await p.isVisible('#d-TEC')) && await p.isVisible('#d-SOC'), label + ': only one definition open at a time');
  await p.click('.info[data-i="SOC"]'); await sleep(30);
  check(!(await p.isVisible('#d-SOC')), label + ': i button hides it again');
}

(async () => {
  PAGE = 'http://127.0.0.1:' + (await listening) + '/index.html';
  const browser = await chromium.launch();
  let s, st, ids;

  // ---------- S0: intro page, privacy notice and the technology list
  console.log('S0 intro, privacy notice, technology list');
  let {ctx, page: p} = await newCtx(browser, 'none');
  check(await p.isVisible('#consent'), 'consent box on the first page');
  check((await appText(p)).includes('Heriot-Watt') && (await appText(p)).includes('minutes'), 'intro names the team and the time needed');
  await p.keyboard.press('ArrowRight'); await sleep(60);
  check(await step(p) === undefined || await step(p) === 'intro', 'ArrowRight does not pass the consent page');
  await p.click('#pn'); await sleep(60);
  check(await p.isVisible('#notice'), 'privacy notice opens');
  check((await p.$eval('#notice', e => e.textContent)).includes('Data Protection Officer'), 'notice gives the Data Protection Officer');
  check((await p.$eval('#notice', e => e.textContent)).includes('your ranking of the technologies') && (await p.$eval('#notice', e => e.textContent)).includes('which version of it you were shown') && (await p.$eval('#notice', e => e.textContent)).includes('2026-10-28c'), 'notice lists the ranking and the assigned version (v2026-10-28c)');
  await p.keyboard.press('Escape'); await sleep(40);
  check(!(await p.isVisible('#notice')), 'Escape closes the notice');
  await p.click('#pn'); await sleep(40); await p.click('#nclose'); await sleep(40);
  check(!(await p.isVisible('#notice')), 'Close button closes the notice');
  await p.check('#consent'); await sleep(30);
  check(!!(await state(p)).consentAt, 'consent time recorded');
  await clickNext(p);
  check((await h2(p)) === 'How many years have you worked in carbon removal or carbon capture and storage?', 'experience question wording');
  await p.click('#exp1'); await sleep(300);
  await p.click('#sector0'); await p.click('#sector2'); await sleep(60);
  check(await p.$eval('#sector4', e => e.disabled) && !(await p.$eval('#sector0', e => e.disabled)), 'a third workplace cannot be chosen');
  await p.click('#sector0'); await sleep(60);
  check(!(await p.$eval('#sector4', e => e.disabled)) && JSON.stringify((await state(p)).sector) === '[2]', 'unticking frees a choice again');
  await p.click('#sector1'); await sleep(60);
  check(JSON.stringify((await state(p)).sector) === '[1,2]', 'two workplaces stored');
  await clickNext(p);
  const rk0 = await p.$$eval('.trk', e => e.map(x => x.dataset.t).join(','));
  check(rk0 === 'dac_ss,dac_ls,dac_ec,beccs,biochar,erw,cew,oae_ec,oae_min,ccs_pow,ccs_ind', 'ranking page lists the same technologies');
  await clickNext(p);
  const ids0 = await p.$$eval('input[name="cat"]', e => e.map(x => x.value).join(','));
  check(await p.$$eval('.opts.cats small', e => e.length === 11 && e.every(x => x.textContent.startsWith('e.g., '))), 'every technology has an e.g., description');
  check(ids0 === 'dac_ss,dac_ls,dac_ec,beccs,biochar,erw,cew,oae_ec,oae_min,ccs_pow,ccs_ind', 'agreed technology list (' + ids0 + ')');
  check(p.errors.length === 0, 'no page errors on intro: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S1: editor interview, three-part technology, navigation detours
  console.log('S1 editor interview (DAC solid sorbent: baseline + randomly assigned co-product)');
  ({ctx, page: p} = await newCtx(browser, 'editor', {random: 0.2}));
  await sleep(150);
  check(await p.isVisible('#toggle-results'), 'Responses button visible to editor');
  await about(p, 1, 2, 'dac_ss');
  check(await step(p) === 'sa:rate', 'lands on the baseline rating page');
  await baselineChecks(p, 'baseline');
  check((await p.$eval('.tag.part', e => e.textContent)) === 'Part 1 · DAC: solid sorbent', 'baseline label is the technology name');
  check((await appText(p)).includes('how likely problems are') && (await appText(p)).includes('how much they would cost'), 'instruction asks to weigh likelihood and cost together');
  const socEx = await p.$eval('#b-SOC', e => e.closest('.brow').querySelector('.bex span').textContent);
  check(socEx.includes('Class VI') && socEx.includes(', or residents or landowners oppose'), 'merged category shows the permit and the acceptance example (' + socEx.slice(0, 60) + '…)');
  check(!/certifier deducts/.test(await appText(p)), 'certification example not shown');
  await clickNext(p);
  check(await step(p) === 'sa:rate' && (await p.$eval('#berr', e => e.textContent)).startsWith('7 not set (marked above)') && (await p.$eval('#berr', e => e.textContent)).includes('Not sure') && await p.$$eval('.srow.need', e => e.length) === 7, 'first Next with unset sliders warns, marks the rows and stays');
  await p.fill('#b-TEC', '7'); await p.fill('#b-PRI', '2'); await p.fill('#b-POL', '5');
  check((await state(p)).ratings.sa.TEC === 7 && (await p.$eval('#bv-TEC', e => e.textContent)) === '7 / 10', 'moving a slider records 0–10 and shows the value');
  check(await p.$eval('#bv-TEC', e => e.classList.contains('hi')) && await p.$eval('#bv-PRI', e => e.classList.contains('lo')) && await p.$eval('#bv-POL', e => e.classList.contains('mid')), 'value label coloured low / middle / high');
  check(await p.$eval('#b-TEC', e => !e.classList.contains('unset') && getComputedStyle(e).filter === 'none'), 'set slider shows full colour');
  check(await p.$eval('#berr', e => e.textContent) === '' && await p.$$eval('.srow.need', e => e.length) === 4, 'warning clears once a slider is set; answered rows lose their mark');
  await p.click('#b-CON'); await sleep(30);
  check((await state(p)).ratings.sa.CON === 5 && (await p.$eval('#bv-CON', e => e.textContent)) === '5 / 10', 'tapping a slider at the middle records 5');
  await p.click('.nsb[data-n="CUR"]'); await sleep(30);
  check((await state(p)).ratings.sa.CUR === 'ns' && await p.$eval('.nsb[data-n="CUR"]', e => e.getAttribute('aria-pressed')) === 'true' && await p.$eval('#bv-CUR', e => e.textContent) === '' && await p.$eval('#b-CUR', e => e.classList.contains('unset') && e.getAttribute('aria-valuetext') === 'Not sure'), 'Not sure is recorded and the slider stays greyed');
  await p.click('.nsb[data-n="CUR"]'); await sleep(30);
  check(!('CUR' in (await state(p)).ratings.sa) && await p.$eval('#bv-CUR', e => e.textContent) === 'Not set', 'tapping Not sure again clears it');
  await p.click('.nsb[data-n="CUR"]'); await p.fill('#b-CUR', '3'); await sleep(30);
  check((await state(p)).ratings.sa.CUR === 3 && await p.$eval('.nsb[data-n="CUR"]', e => e.getAttribute('aria-pressed')) === 'false', 'moving the slider replaces Not sure');
  await p.fill('#b-CUR', '0');
  check((await state(p)).ratings.sa.CUR === 0 && await p.$eval('#bv-CUR', e => e.textContent) === '0 / 10', 'zero is a valid rating');
  await p.focus('#b-TEC'); await p.keyboard.press('ArrowRight'); await sleep(30);
  check((await state(p)).ratings.sa.TEC === 8 && await step(p) === 'sa:rate', 'arrow keys move the focused slider, not the page');
  await p.click('#back'); await sleep(60);
  check(await step(p) === 'sa', 'Back from the rating page returns to the baseline card');
  await clickNext(p);
  check(await step(p) === 'sa:rate' && await p.$eval('#b-TEC', e => e.value) === '8' && await p.$eval('#bv-SOC', e => e.textContent) === 'Not set', 'answers kept after Back/Next; untouched sliders still Not set');
  await p.click('#back'); await sleep(60);
  await p.click('#back'); await sleep(60);
  check(await step(p) === 'plan', 'Back from the baseline card returns to the explanation screen');
  const planTxt = await appText(p);
  check(planTxt.includes('2 parts') && planTxt.includes('Co-product') && planTxt.includes('Definition: Co-product') && !planTxt.includes('Co-host') && !planTxt.includes('e.g.,'), 'explanation screen lists baseline + the assigned variant only');
  check(planTxt.includes('On one page') && planTxt.includes('from 0 (negligible) to 10 (severe)') && !/square|grid/.test(planTxt), 'explanation screen describes the 0–10 sliders, not a grid');
  check((await state(p)).variant === 'cp', 'variant assigned at random when the technology is chosen (cp)');
  await p.click('#back'); await sleep(60);
  check(await step(p) === 'q3', 'Back to the technology question');
  await p.evaluate(() => { Math.random = () => 0.8; });
  await p.click('#c-dac_ss', {force: true}); await sleep(50);
  check((await state(p)).variant === 'cp', 're-selecting the same technology keeps the assigned variant');
  await p.click('#c-erw', {force: true}); await sleep(50);
  check((await state(p)).variant === null, 'a technology without two variants has no random assignment');
  await p.click('#c-dac_ss', {force: true}); await sleep(50);
  check((await state(p)).variant === 'ch', 'choosing the technology again draws a new assignment (ch)');
  await clickNext(p);
  const planTxt2 = await appText(p);
  check(planTxt2.includes('Definition: Co-host') && !planTxt2.includes('Co-product'), 'explanation screen shows the co-host variant only');
  await ctx.close();

  // ---------- S1 (clean run): editor completes three interviews
  ({ctx, page: p} = await newCtx(browser, 'editor', {random: 0.2}));
  await sleep(150);
  await about(p, 1, 2, 'dac_ss');
  await rateBaseline(p, [7,5,'ns',6,3,8,1]);
  check(await step(p) === 'wsa', 'baseline importance after the baseline page');
  check((await h2(p)) === 'Rank the importance of these risks' && (await appText(p)).includes('For the baseline DAC: solid sorbent project'), 'importance heading, naming the baseline project below it');
  check(await p.$$eval('.wn', e => e.map(x => x.textContent).join('|')) === TITLES.join('|'), 'importance rows use the risk titles');
  await p.fill('#w-TEC', '9'); await clickNext(p);
  check(await step(p) === 'cp', 'co-product card after baseline importance');
  check((await h2(p)) === 'Solid-sorbent DAC selling recovered water', 'co-product title shown');
  check((await appText(p)).includes('Where the revenue comes from') && (await appText(p)).includes('recovered water'), 'co-product card states the revenue');
  check(await p.isVisible('#pskip'), 'co-product part can be skipped');
  check((await appText(p)).includes('Say how 7 risks change compared with the baseline'), 'co-product card says the part is rated against the baseline');
  await clickNext(p);
  check(await step(p) === 'cp:cmp', 'Start part 2 opens the comparison page');
  check((await h2(p)) === 'If the project also earned this revenue, how would these risks change?', 'co-product comparison question');
  check((await p.$eval('.scn', e => e.textContent)).includes('Solid-sorbent DAC selling recovered water') && (await p.$eval('.scn', e => e.textContent)).includes('recovered water to local'), 'comparison page describes the scenario and its revenue');
  check((await p.$eval('.tag.part', e => e.textContent)) === 'Part 2 · Co-product', 'comparison page part label');
  check(await p.$$eval('.cn', e => e.map(x => x.textContent).join('|')) === TITLES.join('|'), 'one slider row per risk, in the agreed order');
  check(await p.$eval('.cscale', e => e.textContent) === 'Much lowerLowerSameHigherMuch higher', 'five-point scale from much lower to much higher');
  check(await p.$$eval('input[type=range][data-c]', e => e.length === 7 && e.every(x => x.min === '1' && x.max === '5' && x.value === '3')), '7 five-point sliders starting at the middle');
  check(await p.$$eval('.cv', e => e.every(x => x.textContent === 'Not set')), 'sliders read Not set before they are touched');
  check(!(await p.$('.cell')) && !(await p.$('#ns')), 'no likelihood/impact grid on the comparison page');
  check(!(await p.isVisible('#d-POL')), 'definition hidden by default');
  await p.click('.info[data-i="POL"]'); await sleep(30);
  check(await p.isVisible('#d-POL') && (await p.$eval('#d-POL', e => e.textContent)).includes('subsidies'), 'i button shows the definition');
  await p.click('.info[data-i="CPT"]'); await sleep(30);
  check(!(await p.isVisible('#d-POL')) && await p.isVisible('#d-CPT'), 'only one definition open at a time');
  await p.click('.info[data-i="CPT"]'); await sleep(30);
  check(!(await p.isVisible('#d-CPT')), 'i button hides it again');
  await clickNext(p);
  check(await step(p) === 'cp:cmp' && (await p.$eval('#cerr', e => e.textContent)).startsWith('7 not set') && await p.isVisible('#cerr'), 'first Next with unset sliders warns and stays');
  await p.click('#c-CON'); await sleep(30);
  check((await state(p)).ratings.cp.CON === 0 && await p.$eval('#cv-CON', e => e.textContent) === 'Same', 'tapping a slider at the middle records Same');
  check(await p.$eval('#cerr', e => e.textContent) === '', 'warning clears once a slider is set');
  await p.fill('#c-PRI', '1'); await p.fill('#c-TEC', '2');
  check(await p.$eval('#cv-PRI', e => e.textContent) === 'Much lower' && await p.$eval('#cv-TEC', e => e.textContent) === 'Lower', 'slider labels update');
  await p.click('#back'); await sleep(60); await clickNext(p);
  check(await step(p) === 'cp:cmp' && await p.$eval('#c-PRI', e => e.value) === '1' && await p.$eval('#cv-POL', e => e.textContent) === 'Not set', 'answers kept after Back/Next; untouched sliders still Not set');
  for (const [id, v] of [['POL', 3], ['CUR', 4], ['CPT', 2], ['SOC', 5]]) await p.fill('#c-' + id, String(v));
  await clickNext(p);
  check(await step(p) === 'wcp' && (await appText(p)).includes('co-product version'), 'co-product importance after co-product risks');
  check((await appText(p)).includes('(solid-sorbent DAC selling recovered water)'), 'importance question names the variant');
  await p.click('.info[data-i="CUR"]'); await sleep(30);
  check(await p.isVisible('#d-CUR'), 'info opens definition');
  await p.click('.info[data-i="TEC"]'); await sleep(30);
  check(!(await p.isVisible('#d-CUR')) && await p.isVisible('#d-TEC'), 'only one definition open at a time');
  await p.click('.info[data-i="TEC"]'); await sleep(30);
  check(!(await p.isVisible('#d-TEC')), 'info closes on second click');
  await p.fill('#w-PRI', '2');
  check(await p.$eval('#wv-PRI', e => e.textContent) === '2', 'slider value label updates');
  await p.click('#back'); await sleep(60);
  check(await step(p) === 'cp:cmp', 'Back from importance goes to the comparison page');
  await clickNext(p);
  check(await p.$eval('#w-PRI', e => e.value) === '2', 'slider values kept after Back/Next');
  await p.focus('body'); await p.keyboard.press('ArrowRight'); await sleep(60);
  check(await step(p) === 'review', 'ArrowRight leaves the last importance question; no co-host part');
  s = await state(p);
  check(s.rankDone.sa && s.rankDone.cp && !s.rankDone.ch && s.weights.sa.TEC === 9 && s.weights.cp.PRI === 2 && s.weights.cp.SOC === 5, 'two importance sets saved');
  check((await appText(p)).includes('Part 2 (co-product): 7 of 7') && !(await appText(p)).includes('Part 3'), 'review summarises both parts');
  check(!(await p.$('#startover')) && !(await p.$('#change')) && !(await p.$('[data-redo]')), 'review has no Start over / Change technology / Redo buttons');
  check(await p.isVisible('#ref'), 'respondent reference field shown to editor');
  await p.fill('#ref', 'R1');
  await p.fill('#comment', 'test comment 1');
  await p.click('#next'); await p.click('#next').catch(()=>{}); await sleep(250);
  st = await store(p);
  ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 1, 'double-click on Submit stores exactly one record (got ' + ids.length + ')');
  const d1 = st[ids[0]];
  check(d1 && d1.v === 8 && d1.consent && d1.consent.given === true && d1.consent.at && d1.timing && d1.timing.activeS >= 0, 'record carries consent and timing');
  check(d1 && d1.ref === 'R1' && d1.mode === 'interview' && d1.source === 'interview', 'record carries reference and interview mode');
  check(d1 && d1.v === 8 && Object.keys(d1.ratings.sa).length === 7 && d1.ratings.sa.POL === 'ns' && Object.keys(d1.ratings.cp).length === 7 && Object.keys(d1.ratings.ch).length === 0, 'record has 7 + 7 ratings with not-sure');
  check(d1 && JSON.stringify(ORDER.map(k => d1.ratings.sa[k])) === '[7,5,"ns",6,3,8,1]', 'baseline stored as 0–10 per risk (' + JSON.stringify(d1 && d1.ratings.sa) + ')');
  check(d1 && JSON.stringify(ORDER.map(k => d1.ratings.cp[k])) === '[-1,-2,0,1,0,-1,2]', 'co-product stored as change from the baseline, -2 … +2 (' + JSON.stringify(d1 && d1.ratings.cp) + ')');
  check(d1 && d1.modelStandalone === 'DAC_SS' && d1.parts.cp.model === 'new:DAC_SS_H2O' && d1.parts.ch === null && !d1.parts.cp.skipped && d1.variant === 'cp' && d1.variantRandom === true, 'record links the parts to model cases and records the random assignment');
  check(d1 && d1.weights.sa.TEC === 9 && d1.weights.cp.PRI === 2 && d1.weights.ch === null, 'record has two importance sets');
  check(d1 && d1.comment === 'test comment 1' && d1.exp === '2–5 years' && d1.sector === 'Academia or research', 'record has comment and background');
  check((await h2(p)) === 'Saved.', 'editor sees Saved.');
  check(await p.isVisible('#nextresp'), 'Start next response button shown');
  check(!(await p.$('[data-redo="ch"]')), 'no Redo for the variant that was not assigned');
  await p.click('[data-redo="wcp"]'); await sleep(60);
  check(await step(p) === 'wcp', 'Redo part 2 importance opens that question');
  await p.fill('#w-SOC', '10'); await clickNext(p); await clickNext(p); await sleep(250);
  st = await store(p); ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 1 && st[ids[0]].weights.cp.SOC === 10 && st[ids[0]].weights.sa.TEC === 9 && st[ids[0]].variant === 'cp', 'correction overwrites the same record, same variant');
  await sleep(1200); await p.reload(); await sleep(300);
  check(await until(async () => (await h2(p)) === 'Saved.'), 'done screen survives reload');
  await p.click('#nextresp'); await sleep(60);
  s = await state(p);
  check(s.step === 'intro' && !s.consent && s.exp === null && s.cat === null && !s.docId && !s.ref, 'Start next response gives a blank form starting at consent');

  // interview 2: one-part technology, skip importance, rapid clicks
  await intro(p);
  await p.click('#exp0'); await p.click('#next'); await sleep(400);
  check(await step(p) === 'q2', 'quick select + Next does not skip a question (q2)');
  await p.click('#sector0'); await p.click('#next'); await sleep(400);
  check(await step(p) === 'rank', 'quick select + Next does not skip a question (rank)');
  await p.click('#tskip'); await sleep(60);
  check(await step(p) === 'q3', 'Skip on the ranking goes to the technology question');
  await p.click('#c-erw'); await clickNext(p);
  check(await step(p) === 'plan' && !(await appText(p)).includes('Co-host') && (await appText(p)).includes('normally deployed'), 'one-part explanation for a technology without variants');
  await clickNext(p);
  check(await step(p) === 'sa' && (await p.$eval('.tag.part', e => e.textContent)) === 'Baseline', 'one-part baseline card has no part number');
  await clickNext(p);
  check((await p.$eval('.tag.part', e => e.textContent)) === 'Enhanced rock weathering', 'one-part label is just the technology name');
  await rateBaseline(p, B7(4));
  check(await step(p) === 'wsa', 'one-part technology goes to its importance question');
  await p.click('#wskip'); await sleep(60);
  check(await step(p) === 'review', 'Skip goes to review');
  check((await appText(p)).includes('7 of 7 risks rated') && !(await appText(p)).includes('Part 2'), 'review summary for one-part technology');
  await p.fill('#ref', 'R2'); await clickNext(p); await sleep(250);
  st = await store(p); ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 2, 'second interview stored as a separate record');
  const d2 = ids.map(k => st[k]).find(x => x.ref === 'R2');
  check(d2 && d2.weights.sa === null && d2.parts.cp === null && d2.parts.ch === null && d2.variant === null && d2.variantRandom === false && d2.cat === 'erw' && d2.modelStandalone === 'ERW_AG', 'one-part record has no variants or importance');
  await p.click('#nextresp'); await sleep(60);

  // interview 3: change technology part-way, two-part technology, redo co-host after saving
  await about(p, 3, 0, 'dac_ss');
  await p.fill('#b-TEC', '4');
  for (let k = 0; k < 3; k++) await p.click('#back');
  await sleep(60);
  check(await step(p) === 'q3', 'Back reaches technology question');
  await p.click('#back'); await sleep(60);
  check(await step(p) === 'rank', 'Back from the technology question reaches the ranking');
  await clickNext(p);
  await p.click('#c-cew'); await clickNext(p); await clickNext(p); await clickNext(p);
  check(Object.keys((await state(p)).ratings.sa).length === 0, 'changing technology clears earlier ratings');
  await rateBaseline(p, B7(6)); await clickNext(p);
  check(await step(p) === 'ch' && (await h2(p)) === 'Coastal weathering hosted by a beach-nourishment programme', 'coastal weathering goes straight to its co-host part');
  check((await p.$eval('.tag.part', e => e.textContent)) === 'Part 2 · Co-host', 'co-host numbered as part 2 when there is no co-product');
  await clickNext(p);
  await compareAll(p, 'ch', C7(-1));
  await clickNext(p); // accept default sliders
  check(await step(p) === 'review', 'review reached');
  await p.fill('#ref', 'R3'); await clickNext(p); await sleep(250);
  await p.click('[data-redo="ch"]'); await sleep(60);
  check(await step(p) === 'ch', 'Redo co-host opens its card');
  check(Object.keys((await state(p)).ratings.ch).length === 0 && Object.keys((await state(p)).ratings.sa).length === NR, 'Redo co-host cleared that part only');
  await clickNext(p); await compareAll(p, 'ch', C7(1)); await clickNext(p);
  await clickNext(p); await sleep(250);
  st = await store(p); ids = Object.keys(st).filter(k => k.startsWith('responses/int-'));
  check(ids.length === 3, 'three interviews stored (correction overwrote R3)');

  // fit-to-screen on the baseline page after re-renders and reload
  await p.click('#nextresp'); await about(p, 0, 0, 'biochar');
  for (const v of ['3', '9', '0', '10']) await p.fill('#b-TEC', v);
  await p.click('.nsb[data-n="PRI"]'); await p.click('.info[data-i="SOC"]'); await sleep(60);
  let dims = await p.evaluate(() => [document.documentElement.scrollHeight, innerHeight, document.documentElement.scrollWidth, innerWidth]);
  check(dims[0] <= dims[1] && dims[2] <= dims[3], 'baseline page does not scroll the page itself at 1366x768 (' + dims + ')');
  await sleep(1200); await p.reload(); await sleep(300);
  check(await step(p) === 'sa:rate' && await p.$eval('#b-TEC', e => e.value) === '10' && await p.$eval('.nsb[data-n="PRI"]', e => e.getAttribute('aria-pressed')) === 'true', 'mid-interview reload resumes on the baseline page with its answers');

  // responses panel
  await p.click('#toggle-results'); await sleep(150);
  check(await until(async () => (await p.$eval('#results h2', e => e.textContent)) === '3 responses'), 'panel counts 3 responses');
  check(await p.$$eval('#results tbody tr', r => r.length) >= 6, 'panel table has rows per technology and part');
  check(await p.$$eval('#results .ritem', r => r.length) === 3, 'panel lists 3 individual responses');
  await p.click('#csv'); await sleep(50);
  const dl = await p.evaluate(() => window.__downloads.slice(-1)[0]);
  const lines = dl ? dl.data.split('\n') : [];
  check(dl && dl.filename.endsWith('.csv'), 'CSV download offered');
  check(lines.length === 1 + (14 + 14) + (7 + 0) + (14 + 14), 'CSV has one row per rating and importance score (' + lines.length + ')');
  check(lines.some(l => l.includes('importance co-host')) && lines.some(l => l.includes(',co-product,')), 'CSV labels the parts');
  check(lines[0].includes(',risk,rating_0_10,not_sure,change_vs_baseline,') && !lines[0].includes('likelihood'), 'CSV header has the 0–10 rating column');
  check(lines.some(l => /,baseline,,DAC_SS,TEC,7,0,,,/.test(l)) && lines.some(l => /,baseline,,DAC_SS,POL,,1,,,/.test(l)), 'CSV has the baseline rating and not-sure');
  check(lines.some(l => /,co-host,.*,CON,,0,1,,/.test(l)) && lines.some(l => /,co-product,.*,PRI,,0,-2,,/.test(l)), 'CSV has the change from the baseline for co-product and co-host');
  const tb = await p.$eval('#results tbody', e => e.textContent);
  check(tb.includes('+1 (1)') && tb.includes('7 (1)') && tb.includes('1?'), 'panel shows the median baseline rating, not-sure count and median change');
  const delBtn = await p.$('#results [data-del]');
  await delBtn.click(); await sleep(30);
  check((await p.$eval('#results [data-del]', e => e.textContent)).includes('again'), 'Delete needs a second tap');
  await p.click('#results [data-del]'); await sleep(150);
  check(await until(async () => (await p.$eval('#results h2', e => e.textContent)) === '2 responses'), 'delete removes one response');
  await p.fill('#b-CON', '2'); await sleep(60);
  check(p.errors.length === 0, 'no page errors in editor run: ' + p.errors.join(' | '));
  const editorStore = await store(p);
  await ctx.close();

  // ---------- S2: respondent (Contributor) on their own claude.ai account
  console.log('S2 respondent account');
  ({ctx, page: p} = await newCtx(browser, 'resp', {seed: editorStore}));
  await sleep(200);
  check(!(await p.isVisible('#toggle-results')), 'Responses button hidden for respondent');
  await about(p, 2, 1, 'oae_min');
  await rateBaseline(p, B7(5)); await clickNext(p);
  check(await step(p) === 'ch', 'mineral alkalinity has a co-host part');
  await clickNext(p); await compareAll(p, 'ch', C7(0)); await clickNext(p);
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
  check(s.step === 'q3' && s.exp === 2 && JSON.stringify(s.sector) === '[1]' && s.consent && s.cat === null && !s.done && !s.rid, 'Evaluate another technology keeps background and consent, clears the rest');
  check(s.activeMs < 1500 && Object.keys(s.stepMs || {}).length <= 1 && Date.now() - Date.parse(s.startedAt) < 3000, 'Evaluate another technology restarts the timer');
  check(p.errors.length === 0, 'no page errors in respondent run: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S3: no runtime (public page) -> Google Form; a skipped part; interview offer
  console.log('S3 public page');
  ({ctx, page: p} = await newCtx(browser, 'none', {random: 0.8}));
  await about(p, 0, 4, 'dac_ss', ['beccs', 'dac_ss', 'erw', 'dac_ss', 'dac_ss']);
  await rateBaseline(p, [2,3,'ns',0,10,4,2]); await clickNext(p);
  check(await step(p) === 'ch' && (await h2(p)) === 'DAC at a data centre', 'randomly assigned co-host card reached (no co-product part)');
  check((await p.$eval('.tag.part', e => e.textContent)) === 'Part 2 · Co-host', 'co-host numbered as part 2');
  check((await appText(p)).includes('What changes from the baseline') && (await appText(p)).includes('Data-centre owner'), 'co-host card lists what changes');
  await p.click('#pskip'); await sleep(60);
  check(await step(p) === 'review', 'Skip this part goes to the review');
  await p.click('#back'); await sleep(60);
  check(await step(p) === 'ch' && (await state(p)).skip.ch === true, 'Back returns to the skipped part card');
  await p.click('#pskip'); await sleep(60);
  check((await appText(p)).includes('Part 2 (co-host): skipped'), 'review shows the skipped part');
  await clickNext(p); await sleep(200);
  check(await until(async () => (await h2(p)) === 'Thank you for your time!'), 'saved via Google Form when no claude.ai runtime');
  check(p.posts.length === 1, 'exactly one form POST (' + p.posts.length + ')');
  const form = new URLSearchParams(p.posts[0] || '');
  const code = form.get('entry.269220021') || '';
  check(code.startsWith('CDRRISK2.'), 'form POST carries the answer code');
  const cols = (form.get('entry.530102048') || '').split('|'); const hdr = await p.evaluate(() => window.__tableHeader);
  check(cols.length === hdr.length && hdr.length === 60, 'table record has one value per header column (' + cols.length + '/' + hdr.length + ')');
  check(cols[0] === 'R8' && cols[7] === 'DAC: solid sorbent' && cols[8] === '' && cols[9] === 'DAC at a data centre (skipped)' && cols[10] === 'random' && hdr[10] === 'variant_assignment', 'table record names technology, assigned part and assignment');
  check(hdr.slice(11, 18).join('|') === TITLES.map(t => 'BL ' + t + ' rating').join('|') && hdr.indexOf('BL Technology risk likelihood') < 0 && hdr.indexOf('BL Technology risk impact') < 0, 'one baseline rating column per risk, no likelihood or impact columns');
  check(cols.slice(11, 18).join('|') === '2|3|not sure|0|10|4|2', 'baseline ratings in the table record: 0–10, not sure (' + cols.slice(11, 18).join('|') + ')');
  check(cols[hdr.indexOf('CH Technology risk change')] === '' && hdr.indexOf('CH Technology risk likelihood') < 0 && hdr.indexOf('CP Permitting and acceptance risk change') > 0 &&
        cols[hdr.indexOf('BL importance Policy risk')] === '5' && cols[hdr.indexOf('CH importance Policy risk')] === '' && hdr.indexOf('BL Certification risk likelihood') < 0 && hdr.indexOf('BL Regulatory risk likelihood') < 0, 'table record values in the right columns, 7 risks');
  check(!!cols[hdr.indexOf('consent_at')], 'table record carries consent time');
  check(hdr.slice(-5).join() === 'started_at,total_seconds,active_seconds,seconds_per_screen,technology_risk_rank', 'timing and ranking columns at the end');
  check(cols[59] === '1=BECCS;2=Enhanced rock weathering;3=DAC: solid sorbent', 'technology ranking recorded in tap order, re-tap removes (' + cols[59] + ')');
  const tStart = cols[hdr.indexOf('started_at')], tTot = +cols[hdr.indexOf('total_seconds')], tAct = +cols[hdr.indexOf('active_seconds')], tScr = cols[hdr.indexOf('seconds_per_screen')];
  check(!isNaN(Date.parse(tStart)) && Date.parse(tStart) <= Date.parse(cols[1]), 'started_at is a time before submission (' + tStart + ')');
  check(tTot >= 1 && tAct >= 1 && tAct <= tTot + 1, 'total and active seconds recorded (' + tTot + ' / ' + tAct + ')');
  check(/^intro=\d+;q1=\d+;/.test(tScr) && tScr.includes('sa=') && tScr.includes('sa:rate=') && !tScr.includes('sa:TEC=') && !tScr.includes('ch:') && !tScr.includes('cp') && tScr.includes('review='), 'seconds per screen recorded in survey order (' + tScr.slice(0, 60) + '…)');
  const sent = JSON.parse(Buffer.from(code.slice(9), 'base64').toString('utf8'));
  check(sent.v === 8 && sent.ratings.sa.CUR === 0 && sent.ratings.sa.CON === 10 && sent.ratings.sa.POL === 'ns' && (sent.techRank || []).join() === 'beccs,erw,dac_ss' && sent.timing && sent.timing.totalS === tTot && sent.cat === 'dac_ss' && Object.keys(sent.ratings.sa).length === 7 && Object.keys(sent.ratings.cp).length === 0 && Object.keys(sent.ratings.ch).length === 0 && sent.parts.cp === null && sent.parts.ch.skipped === true && sent.weights.ch === null && sent.variant === 'ch' && sent.variantRandom === true && sent.rid && sent.consent.given, 'decoded form payload is complete');
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
  // early preprint: separate from the interview offer, not linked to the response number
  check(await p.isVisible('#ppe') && (await appText(p)).includes('If you’d like to receive an early preprint, please enter your email.'), 'preprint offer shown separately');
  const nPosts = p.posts.length;
  await p.fill('#ppe', 'bad'); await p.click('#ppsend'); await sleep(60);
  check((await p.$eval('#pperr', e => e.textContent)).length > 0 && p.posts.length === nPosts, 'invalid preprint email is not sent');
  await p.fill('#ppe', 'reader@example.org'); await p.click('#ppsend'); await sleep(300);
  check(p.posts.length === nPosts + 1, 'preprint email sent as its own form row');
  const pf = new URLSearchParams(p.posts[p.posts.length - 1] || '');
  const ppRow = (pf.get('entry.530102048') || '').split('|');
  check(pf.get('entry.269220021') === 'PREPRINT' && ppRow[0] === 'PP1' && ppRow[2] === 'reader@example.org' && ppRow.length === 3 && !ppRow.join('|').includes(sent.rid), 'preprint row has no response number');
  check((await appText(p)).includes('We will send the preprint to reader@example.org'), 'preprint confirmation shown');
  await p.click('#another'); await sleep(60);
  check(await step(p) === 'q3', 'Evaluate another technology returns to the technology question');
  check(p.errors.length === 0, 'no page errors without runtime: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S3b: form unreachable -> email fallback
  console.log('S3b form unreachable');
  ({ctx, page: p} = await newCtx(browser, 'none'));
  await p.unroute(/docs\.google\.com\/forms/); await p.route(/docs\.google\.com\/forms/, r => {}); // never answers
  await about(p, 0, 0, 'erw'); await rateBaseline(p, B7(3));
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
    for (let k = 0; k < 50 && (await step(p)) !== 'review'; k++) { if ((await step(p)) === 'sa:rate') await rateBaseline(p, B7(n + 2)); else await clickNext(p); }
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
  await p.evaluate(k => localStorage.setItem(k, JSON.stringify({step:'sa:TEC', cat:'biooil', ratings:{sa:{},cp:{},ch:{}}, weights:{sa:{},cp:{},ch:{}}, rankDone:{}, skip:{}})), KEY);
  await p.reload(); await sleep(250);
  check(await p.isVisible('#consent'), 'removed technology in saved state falls back to the intro');
  await p.evaluate(k => localStorage.setItem(k, JSON.stringify({step:'sa:TEC', consent:true, cat:'erw', sector:[0], exp:0, ratings:{sa:{TEC:[3,3]},cp:{},ch:{}}, weights:{sa:{},cp:{},ch:{}}, rankDone:{}, skip:{}})), KEY);
  await p.reload(); await sleep(250);
  check(await p.isVisible('#consent'), 'a saved step from the grid version falls back to the intro');
  check(p.errors.length === 0, 'no page errors with stale state: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S6: phone width
  console.log('S6 phone');
  ({ctx, page: p} = await newCtx(browser, 'editor', {viewport:{width:390, height:844}}));
  await about(p, 1, 1, 'beccs');
  const pw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(pw[0] <= pw[1], 'no sideways scroll on phone (' + pw + ')');
  const bw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.documentElement.scrollHeight, innerHeight]);
  check(bw[0] <= bw[1] && bw[2] <= bw[3], 'baseline page has no sideways or page scroll on phone (' + bw + ')');
  const bsw = await p.$eval('#b-TEC', e => e.getBoundingClientRect());
  check(bsw.width >= 250 && bsw.height >= 28, 'baseline sliders use the full width and stay tappable on phone (' + Math.round(bsw.width) + 'x' + Math.round(bsw.height) + 'px)');
  const nsb = await p.$eval('.nsb[data-n="SOC"]', e => e.getBoundingClientRect().height);
  check(nsb >= 20, 'Not sure button tappable on phone (' + Math.round(nsb) + 'px)');
  for (const [id, v] of [['TEC', 7], ['PRI', 2], ['POL', 5]]) await p.fill('#b-' + id, String(v));
  await p.click('.nsb[data-n="CUR"]');
  await p.screenshot({path: path.join(__dirname, 'phone-baseline.png')});
  await p.click('.nsb[data-n="CUR"]');
  await rateBaseline(p, B7(5)); await clickNext(p);
  check(await step(p) === 'cp' && (await h2(p)) === 'Biomass plant turning its CO₂ into methane' && (await appText(p)).includes('no removal credits'), 'BECCS co-product: CO₂ turned into methane, no removal credits');
  await clickNext(p);
  check(await step(p) === 'cp:cmp' && (await h2(p)) === 'If the project also earned this revenue, how would these risks change?', 'BECCS co-product comparison page');
  const cw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.documentElement.scrollHeight, innerHeight]);
  check(cw[0] <= cw[1] && cw[2] <= cw[3], 'comparison page has no sideways or page scroll on phone (' + cw + ')');
  const sw = await p.$eval('#c-TEC', e => e.getBoundingClientRect().width);
  check(sw >= 250, 'sliders use the full width on phone (' + Math.round(sw) + 'px)');
  await p.screenshot({path: path.join(__dirname, 'phone-compare.png')});
  await compareAll(p, 'cp', [0, 1, -1, 0, 0, 1, 0]);
  const rw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(rw[0] <= rw[1], 'importance question has no sideways scroll on phone');
  await p.screenshot({path: path.join(__dirname, 'phone-rank.png')});
  check(p.errors.length === 0, 'no page errors on phone: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S8: phone touch on the comparison page (taps that leave the value unchanged must count)
  console.log('S8 phone touch');
  ctx = await browser.newContext({...devices['Pixel 7']});
  await ctx.addInitScript(k => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem(k, JSON.stringify({step:'ch:cmp', consent:true, exp:1, sector:[1], cat:'cew', ratings:{sa:{TEC:5,PRI:5,POL:5,CUR:5,CON:5,CPT:5,SOC:5},cp:{},ch:{}},
      weights:{sa:{},cp:{},ch:{}}, rankDone:{sa:true,cp:false,ch:false}, skip:{cp:false,ch:false}, variant:null, techRank:[]})); }, KEY);
  p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto(PAGE); await sleep(250);
  check(await step(p) === 'ch:cmp', 'touch test starts on the co-host comparison page');
  const tapAt = async (id, frac) => { const el = await p.$('#c-' + id); await el.scrollIntoViewIfNeeded(); const bb = await el.boundingBox();
    await p.touchscreen.tap(bb.x + bb.width * frac, bb.y + bb.height / 2); await sleep(150); return p.$eval('#cv-' + id, e => e.textContent); };
  check(await tapAt('TEC', 0.5) === 'Same' && (await state(p)).ratings.ch.TEC === 0, 'a phone tap on a slider at the middle records Same');
  check(await tapAt('PRI', 0.95) === 'Much higher' && (await state(p)).ratings.ch.PRI === 2, 'a phone tap near the end records Much higher');
  await p.tap('#next'); await sleep(150);
  check(await step(p) === 'ch:cmp' && await p.$$eval('.srow.need', e => e.length) === 5 && (await p.$eval('#cerr', e => e.textContent)).startsWith('5 not set (marked above)'), 'Next with unset sliders marks the 5 unset rows');
  for (const id of ['POL', 'CUR', 'CON', 'CPT', 'SOC']) await tapAt(id, 0.5);
  check(await p.$$eval('.srow.need', e => e.length) === 0 && await p.$eval('#cerr', e => e.textContent) === '', 'answering clears the marks and the warning');
  await p.tap('#next'); await sleep(200);
  check(await step(p) === 'wch', 'one tap on Next moves on once every slider is answered');
  check(p.errors.length === 0, 'no page errors with touch: ' + p.errors.join(' | '));
  await ctx.close();

  // ---------- S8b: phone touch on the baseline page (a tap at 5 leaves the value unchanged and must count)
  console.log('S8b phone touch, baseline');
  ctx = await browser.newContext({...devices['Pixel 7']});
  await ctx.addInitScript(k => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem(k, JSON.stringify({step:'sa:rate', consent:true, exp:1, sector:[1], cat:'erw', ratings:{sa:{},cp:{},ch:{}},
      weights:{sa:{},cp:{},ch:{}}, rankDone:{sa:false,cp:false,ch:false}, skip:{cp:false,ch:false}, variant:null, techRank:[]})); }, KEY);
  p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto(PAGE); await sleep(250);
  check(await step(p) === 'sa:rate', 'touch test starts on the baseline page');
  const tapB = async (id, frac) => { const el = await p.$('#b-' + id); await el.scrollIntoViewIfNeeded(); const bb = await el.boundingBox();
    await p.touchscreen.tap(bb.x + bb.width * frac, bb.y + bb.height / 2); await sleep(150); return (await state(p)).ratings.sa[id]; };
  check(await tapB('TEC', 0.5) === 5 && await p.$eval('#bv-TEC', e => e.textContent) === '5 / 10', 'a phone tap on a baseline slider at the middle records 5');
  check(await tapB('PRI', 0.97) === 10 && await tapB('POL', 0.03) === 0, 'phone taps near the ends record 10 and 0');
  await p.tap('.nsb[data-n="CUR"]'); await sleep(100);
  check((await state(p)).ratings.sa.CUR === 'ns', 'a phone tap on Not sure records it');
  await p.tap('#next'); await sleep(150);
  check(await step(p) === 'sa:rate' && await p.$$eval('.srow.need', e => e.length) === 3 && (await p.$eval('#berr', e => e.textContent)).startsWith('3 not set (marked above)'), 'Next with unset sliders marks the 3 unset rows');
  await tapB('CON', 0.5); await p.tap('.nsb[data-n="CPT"]'); await sleep(100); await tapB('SOC', 0.5);
  check(await p.$$eval('.srow.need', e => e.length) === 0 && await p.$eval('#berr', e => e.textContent) === '', 'answering or Not sure clears the marks and the warning');
  await p.tap('#next'); await sleep(200);
  check(await step(p) === 'wsa', 'one tap on Next moves on once every risk is answered');
  check(p.errors.length === 0, 'no page errors with touch on the baseline: ' + p.errors.join(' | '));
  await ctx.close();

  await browser.close(); server.close();
  console.log(`\n${passes} checks passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
