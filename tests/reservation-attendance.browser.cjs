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

 await page.waitForTimeout(300);
 await page.evaluate(()=>{
   state.reservations=[{id:'22222222-2222-4222-8222-222222222222',name:'Cliente Teste',phone:'22999991111',house:'Leña',date:getLocalDateStr(0),people:2,status:'Confirmada',customerId:state.clients[0].id}];
   state.visits=[];
   go('reservations');
 });
 await page.evaluate(()=>convertReservation(state.reservations[0].id));
 assert.equal(await page.evaluate(()=>state.reservations[0].status),'Confirmada','opening form must not mark presence');
 assert.equal(await page.evaluate(()=>reservationOutcomes().get(state.reservations[0].id).status),'Aguardando');
 await page.locator('#ciPeople').fill('3');
 await page.locator('#ciName').fill('Cliente Teste');
 await page.locator('#ciPhone').fill('(22) 99999-1111');
 await page.evaluate(()=>el('checkinForm').requestSubmit());
 await page.waitForFunction(()=>state.visits.length===1);
 await page.waitForFunction(()=>crmWrites.size===0);
 assert.equal(await page.evaluate(()=>reservationOutcomes().get(state.reservations[0].id).status),'Compareceu');
 assert(writes.some(w=>w.table==='crm_save_visit'),'visit queued to existing RPC');
 assert(writes.some(w=>w.table==='crm_save_reservation' && w.body.payload.notes.includes('[PRESENCA:')),'link persisted through existing reservation RPC');
 await page.evaluate(()=>{go('reservations');});
 assert((await page.locator('#reservationAttendanceSummary').innerText()).includes('100%'));
 assert((await page.locator('#reservationsBody').innerText()).includes('Atendente Teste'));
 // Roundtrip the saved notes as they are returned from the server.
 await page.evaluate(()=>{state.reservations=JSON.parse(JSON.stringify(state.reservations));state.visits=JSON.parse(JSON.stringify(state.visits));renderReservations();});
 assert.equal(await page.evaluate(()=>reservationOutcomes().get(state.reservations[0].id).status),'Compareceu');
 // Historic records are suggested for review, with no automatic absence.
 await page.evaluate(()=>{
   const d=getLocalDateStr(-1);
   state.reservations.push({id:'33333333-3333-4333-8333-333333333333',name:'Reserva antiga',phone:'22988882222',house:'Leña',date:d,people:4,status:'Convertida'});
   state.visits.push({id:'44444444-4444-4444-8444-444444444444',name:'Reserva antiga',phone:'5522988882222',house:'Leña',date:d,people:3,arrival:'19:10',operatorReception:'Recepção Teste'});
   state.reservations.push({id:'55555555-5555-4555-8555-555555555555',name:'Ausência conferida',phone:'22977773333',house:'Leña',date:d,people:2,status:'Confirmada'});
   el('reservationTargetFilter').value='all'; renderReservations();
 });
 assert.equal(await page.evaluate(()=>reservationOutcomes().get(state.reservations[1].id).status),'Não compareceu');
 page.on('dialog',d=>d.accept());
 await page.evaluate(()=>openReservationAttendance(state.reservations[1].id));
 await page.getByRole('button',{name:/Vincular Reserva antiga/}).click();
 assert.equal(await page.evaluate(()=>reservationOutcomes().get(state.reservations[2].id).status),'Não compareceu','past reservation without check-in is automatically absent');
 assert.equal(await page.evaluate(()=>reservationOutcomes().get(state.reservations[1].id).status),'Compareceu');
 assert.equal(await page.evaluate(()=>reservationOutcomes().get(state.reservations[2].id).status),'Não compareceu');
 assert((await page.locator('#reservationAttendanceSummary').innerText()).includes('66,7%'));
 assert(!(await page.locator('#reservationAttendanceSummary').innerText()).includes('pessoas previstas'));
 assert.equal(await page.locator('#reservationAttendanceSummary .kpi-chip').count(),5);
 assert((await page.locator('#reservationAttendanceSummary .kpi-chip').nth(1).innerText()).includes('2 = 66,7%'));
 assert((await page.locator('#reservationAttendanceSummary .kpi-chip').nth(2).innerText()).includes('1 = 33,3%'));
 const layout=await page.locator('.reservation-kpis').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,cards:[...e.children].map(c=>c.getBoundingClientRect().width)}));
 assert(layout.scroll<=layout.width,'cards wrap rather than horizontally overflow');
 assert(layout.cards.every(w=>w<180),'cards use compact content widths');
 assert(layout.cards.every(w=>Math.abs(w-layout.cards[0])<1),'all cards have the same width');
 await page.locator('#reservationAttendanceFilter').selectOption('Não compareceu');
 assert.equal(await page.locator('#reservationsBody tr').count(),1);
 assert((await page.locator('#reservationAttendanceSummary').innerText()).includes('66,7%'),'presence filter must not bias rates');
 await page.locator('#reservationAttendanceFilter').selectOption('all');
 await page.setViewportSize({width:1920,height:1080});
 await page.screenshot({path:'../attendance-desktop.png',fullPage:true});
 await page.evaluate(()=>clearReservationAttendance(state.reservations[1].id));
 assert.equal(await page.evaluate(()=>state.visits.length),2,'undo preserves saved visits');
 assert.equal(await page.evaluate(()=>reservationOutcomes().get(state.reservations[1].id).status),'Não compareceu');
 await page.evaluate(()=>{
   state.reservations.push({id:'66666666-6666-4666-8666-666666666666',name:'Cliente Teste',phone:'22999991111',house:'Leña',date:getLocalDateStr(0),people:2,status:'Confirmada',customerId:state.clients[0].id});
   go('checkin');selectCheckinClient(state.clients[0].id);
   el('ciPeople').value='2';el('ciHouse').value='Leña';
   el('checkinForm').requestSubmit();
 });
 await page.waitForFunction(()=>state.visits.length===3);
 assert.equal(await page.evaluate(()=>reservationOutcomes().get('66666666-6666-4666-8666-666666666666').status),'Compareceu','ordinary check-in links a unique reservation automatically');
 assert.deepEqual(errors,[]);
 console.log('Attendance browser: opening, saving, RPC persistence, historic review, absence, rates, filters and undo passed');
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
