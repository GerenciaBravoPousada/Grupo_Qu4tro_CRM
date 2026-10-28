const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const handlers={}, writes=[], pending=[];
let offline=false, response;
const origin='https://crm.example.invalid';
const context={URL,Request,Response,console,
 self:{location:{origin},addEventListener:(name,fn)=>handlers[name]=fn},
 caches:{match:async()=>new Response('old eight cards'),open:async()=>({put:async(req,res)=>writes.push(await res.text())})},
 fetch:async(req,options)=>{assert.equal(options.cache,'no-cache');if(offline)throw Error('offline');return new Response('new five cards');}
};
vm.runInNewContext(fs.readFileSync('sw.js','utf8'),context);
async function run(){
 const request=new Request(origin+'/reservation-attendance.js?v=1.0.55');
 handlers.fetch({request,respondWith:p=>response=p,waitUntil:p=>pending.push(p)});
 assert.equal(await (await response).text(),'new five cards','online code must bypass stale cached JavaScript');
 await Promise.all(pending);assert.deepEqual(writes,['new five cards']);
 offline=true;
 handlers.fetch({request,respondWith:p=>response=p,waitUntil:p=>pending.push(p)});
 assert.equal(await (await response).text(),'old eight cards','offline retains cached code');
 const html=fs.readFileSync('index.html','utf8'),sw=fs.readFileSync('sw.js','utf8');
 assert(html.includes('reservation-attendance.js?v=1.0.55'));
 assert(sw.includes("'./reservation-attendance.js?v=1.0.55'"));
 console.log('Script cache: fresh online, fallback offline, matching versioned URL passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
