const { chromium } = require('playwright'); const path=require('path');
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
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const check=(c,m)=>{ if(!c){fails++; console.log('  FAIL: '+m);} };
(async()=>{ PAGE='http://127.0.0.1:'+(await listening)+'/index.html'; const b=await chromium.launch();
 for (const [w,h] of [[1366,768],[1280,720],[1536,864],[1920,1080],[390,844],[360,740]]) {
  for (const catId of ['cew','erw']) {
   const ctx=await b.newContext({viewport:{width:w,height:h}}); const p=await ctx.newPage();
   await p.route(/fonts\./,r=>r.abort()); await p.route(/docs\.google\.com/,r=>r.fulfill({status:200,body:'ok'}));
   await p.goto(PAGE); await sleep(150);
   const navY=new Set(), nextX=new Set(), sliders=new Set(); let docScroll=0, innerScroll=[];
   const snap=async(label)=>{
     const r=await p.evaluate(()=>{ const n=document.getElementById('next'); const b=document.querySelector('input.bsl'); const sc=document.getElementById('scroll');
       return {next:n?n.getBoundingClientRect().toJSON():null, bsl:b?[Math.round(b.getBoundingClientRect().width),Math.round(b.getBoundingClientRect().left)]:null,
         doc:[document.documentElement.scrollHeight, innerHeight, document.documentElement.scrollWidth, innerWidth], inner:sc.scrollHeight>sc.clientHeight+1}; });
     if (r.next){ navY.add(Math.round(r.next.top)); nextX.add(Math.round(r.next.left)); }
     if (r.bsl) sliders.add(r.bsl.join('@'));
     if (r.doc[0]>r.doc[1] || r.doc[2]>r.doc[3]) docScroll++;
     if (r.inner) innerScroll.push(label);
   };
   await snap('intro'); await p.check('#consent'); await p.click('#next'); await sleep(60); await snap('q1'); await p.click('#exp1'); await sleep(260); await snap('q2'); await p.click('#sector1'); await sleep(60); await p.click('#next'); await sleep(60); await snap('rank'); await p.click('.trk[data-t="beccs"]'); await p.click('#next'); await sleep(60); await snap('q3');
   await p.click('#c-'+catId); await p.click('#next'); await sleep(60); await snap('plan'); await p.click('#next'); await sleep(60);
   for (let k=0;k<50;k++){ const st=await p.evaluate(()=>JSON.parse(localStorage.getItem('cdr-risk-survey-v11')).step); if(st==='w'){await snap(st);} if(st==='review'||st==='w'){ break; }
     await snap(st);
     if (st==='sa:rate') { for (const [i,id] of ['TEC','PRI','POL','CUR','CON','CPT','SOC'].entries()) { await p.fill('#b-'+id, String((i*3)%11)); await snap(st+':'+id); } await p.click('.nsb[data-n="CPT"]'); await p.click('.info[data-i="SOC"]'); await sleep(30); await snap(st+':info'); }
     await p.click('#next'); await sleep(60); }
   if (w===1366 && catId==='cew') { await p.screenshot({path:path.join(__dirname,'v-rank.png')}); }
   await p.click('.info[data-i="CUR"]'); await sleep(30); await snap('rank-info');
   await p.click('#next'); await sleep(60); await snap('review');
   const tag=w+'x'+h+' '+catId;
   check(navY.size===1, tag+': Next button moves vertically '+[...navY]);
   check(nextX.size===1, tag+': Next button moves horizontally '+[...nextX]);
   check(sliders.size===1, tag+': baseline slider width/position changes '+[...sliders]);
   check(docScroll===0, tag+': page itself scrolls on '+docScroll+' screens');
   console.log(tag.padEnd(18),'slider',[...sliders].join(),'next y',[...navY].join(),'inner scroll on:',[...new Set(innerScroll.map(x=>x.split(':').slice(0,2).join(':')))].join(',')||'none');
   if (catId==='cew') { await p.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('cdr-risk-survey-v11')); s.step='ch:cmp'; s.done=null; localStorage.setItem('cdr-risk-survey-v11',JSON.stringify(s)); }); await p.reload(); await sleep(150); await p.screenshot({path:path.join(__dirname,'v-'+w+'x'+h+'.png')}); }
   await ctx.close();
  } }
 console.log(fails?fails+' visual checks failed':'all visual checks passed'); await b.close(); server.close(); })();
