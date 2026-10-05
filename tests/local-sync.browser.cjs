const http=require('http'),fs=require('fs'),assert=require('assert');
const {chromium}=require('C:/Users/Jean/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const customer={id:'11111111-1111-4111-8111-111111111111',name:'Cliente Teste',phone:'5522999991111',total_visits:1,updated_at:'2026-10-05T10:00:00Z',created_at:'2026-10-01T10:00:00Z'};
const user={id:'TEST-U',name:'Atendente Teste',email:'test@example.invalid',password:'test-only',role:'Atendimento',houses:['Leña'],active:true};
const tables={customers:[customer],visits:[],reservations:[],app_users:[user],app_settings:[{id:'Leña'}],crm_reservation_events:[]};
const versions=Object.fromEntries(['customers','visits','reservations','app_users','app_settings'].map(t=>[t,'v1']));
const reads=[],writes=[],errors=[];let failWrites=false;
const server=http.createServer((req,res)=>{
 let path=req.url.split('?')[0]; if(path==='/')path='/index.html';
 try{let content=fs.readFileSync('.'+path);if(path==='/index.html')content=content.toString().replace(/const SEED_DATA=.*;\r?\n/, 'const SEED_DATA={clients:[],visits:[],reservations:[]};\n');res.setHeader('Content-Type',path.endsWith('.js')?'application/javascript':'text/html');res.end(content);}catch(_){res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
 const context=await browser.newContext({serviceWorkers:'block'});
 const page=await context.newPage();
 await page.clock.install({time:new Date('2026-10-05T15:00:00Z')});
 page.on('pageerror',e=>{errors.push(e.message);console.log(e.stack);});
 page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log('BROWSER',m.text().slice(0,200));});
 await page.addInitScript(u=>{if(localStorage.getItem('grupo_qu4tro_gestao_clientes_v1'))return;localStorage.setItem('grupo_qu4tro_gestao_clientes_v1',JSON.stringify({clients:[],visits:[],reservations:[],users:[u]}));localStorage.setItem('qu4tro_auth_user',u.id);},user);
 await page.route('**/rest/v1/**',async route=>{
  const request=route.request(),url=new URL(request.url()),table=url.pathname.split('/').pop();
  let data;
  if(request.method()==='GET' || request.method()==='HEAD'){
   reads.push({table,params:url.search});
   data=table==='bravo_data_versions'?Object.entries(versions).map(([table_name,version])=>({table_name,version})):structuredClone(tables[table]||[]);
   const idFilter=url.searchParams.get('id');if(idFilter?.startsWith('in.'))data=data.filter(r=>idFilter.includes(r.id));
   if(url.searchParams.get('select')==='id')data=data.map(r=>({id:r.id}));
  }else{
   writes.push({table,body:request.postDataJSON()});
   if(failWrites && table==='crm_save_customer'){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'40001',message:'Conflito de atualização'})});return;}
   data=table==='crm_save_customer'?{id:customer.id,updated_at:'2026-10-05T15:00:01Z'}:null;
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'content-range':'0-0/1'}});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>typeof state!=='undefined' && state.crmCache?.lastRefresh).catch(async e=>{console.log('DEBUG',errors,await page.evaluate(()=>({user:state.currentUser,cache:state.crmCache,sdk:!!window.supabase})),reads);throw e;});
 assert.deepEqual(errors,[]);
 assert(reads.some(r=>r.table==='reservations' && r.params.includes('house=in.')),'reservations scoped by house');
 let before=reads.filter(r=>['customers','visits','reservations'].includes(r.table)).length;
 await page.clock.fastForward(35000);
 assert.equal(reads.filter(r=>['customers','visits','reservations'].includes(r.table)).length,before,'no 30-second full pull');
 await page.evaluate(()=>pullAllFromSupabase());
 assert.equal(reads.filter(r=>['customers','visits','reservations'].includes(r.table)).length,before,'unchanged manifest reuses lists');
 versions.customers='v2';
 await page.evaluate(()=>pullAllFromSupabase());
 assert.equal(reads.filter(r=>['customers','visits','reservations'].includes(r.table)).length,before+1,'only changed table downloaded');
 await page.evaluate(()=>dbSyncCustomer(state.clients[0]));
 assert(writes.some(w=>w.table==='crm_save_customer'),'customer is immediately written');
 assert.equal(reads.filter(r=>['customers','visits','reservations'].includes(r.table)).length,before+1,'write does not reload base');
 const id='22222222-2222-4222-8222-222222222222';
 tables.reservations=[{id,house:'Leña',reservation_date:'2026-10-05',customer_name:'Reserva Teste',people_count:2,status:'Confirmada'}];
 await page.evaluate(id=>{crmPendingReservations.add(id);crmRenderStatus();},id);
 await page.evaluate(()=>crmDeferReservations());
 assert(await page.locator('#crmReservationNotice').isVisible());
 await page.evaluate(()=>crmAcceptReservations());
 assert.equal(await page.evaluate(()=>state.reservations.length),1);
 assert(reads.filter(r=>r.table==='reservations').at(-1).params.includes('id=in.'),'only changed reservation IDs fetched');
 tables.reservations=[];
 await page.evaluate(id=>crmPendingReservations.add(id),id);await page.evaluate(()=>crmAcceptReservations());
 assert.equal(await page.evaluate(()=>state.reservations.length),0,'deleted reservation removed locally');
 assert.equal(await page.evaluate(()=>crmScheduleInfo(new Date('2026-10-05T10:15:00Z')).minute),435,'07:15 Brazil time');
 assert.equal(await page.evaluate(()=>crmScheduleInfo(new Date('2026-10-05T21:15:00Z')).minute),1095,'18:15 Brazil time');
 before=reads.filter(r=>['customers','visits','reservations'].includes(r.table)).length;
 await page.reload();await page.waitForFunction(()=>!crmRefreshPromise && state.crmCache?.lastRefresh);await page.evaluate(()=>pullAllFromSupabase());
 assert.equal(reads.filter(r=>['customers','visits','reservations'].includes(r.table)).length,before,'F5 reuses persisted unchanged lists');
 failWrites=true;
 await page.evaluate(()=>dbSyncCustomer(state.clients[0]));
 for(let i=0;i<3;i++)await page.evaluate(()=>processOutboxQueue());
 assert.equal(await page.evaluate(async()=>(await getOutboxItems()).length),1,'failed edit remains in durable outbox');
 assert.equal(await page.evaluate(()=>crmFlushBeforeLogout()),false,'logout blocked with pending edit');
 assert(await page.locator('#crmConflictNotice').isVisible(),'conflict is visible');
 failWrites=false;page.once('dialog',dialog=>dialog.accept());
 await page.evaluate(()=>crmReviewConflicts());
 assert.equal(await page.evaluate(async()=>(await getOutboxItems()).length),0,'reviewed conflict can be saved');
 assert.equal(await page.evaluate(()=>crmFlushBeforeLogout()),true,'logout allowed once all writes confirmed');
 let manifests=reads.filter(r=>r.table==='bravo_data_versions').length;
 await page.clock.setSystemTime(new Date('2026-10-05T21:14:00Z'));await page.evaluate(()=>crmDailyTick());
 assert.equal(reads.filter(r=>r.table==='bravo_data_versions').length,manifests,'night house waits until 18:15');
 await page.clock.setSystemTime(new Date('2026-10-05T21:15:00Z'));await page.evaluate(()=>crmDailyTick());
 assert.equal(reads.filter(r=>r.table==='bravo_data_versions').length,manifests+1,'night house refreshes at 18:15');
 await page.evaluate(()=>crmDailyTick());
 assert.equal(reads.filter(r=>r.table==='bravo_data_versions').length,manifests+1,'scheduled refresh runs once per day');
 user.houses=['Bravo Café'];
 await page.evaluate(()=>{state.users.find(u=>u.id===state.currentUser).houses=['Bravo Café'];sessionStorage.setItem('qu4tro_reception_house','Bravo Café');});
 manifests=reads.filter(r=>r.table==='bravo_data_versions').length;
 await page.clock.setSystemTime(new Date('2026-10-06T10:14:00Z'));await page.evaluate(()=>crmDailyTick());
 assert.equal(reads.filter(r=>r.table==='bravo_data_versions').length,manifests,'coffee house waits until 07:15');
 await page.clock.setSystemTime(new Date('2026-10-06T10:15:00Z'));await page.evaluate(()=>crmDailyTick());
 assert.equal(reads.filter(r=>r.table==='bravo_data_versions').length,manifests+1,'coffee house refreshes at 07:15');
 assert.deepEqual(errors,[]);
 console.log('PASS: login, house scope, no polling, version cache, immediate write, deferred alert, selective update, cancellation, Brazil schedules');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
