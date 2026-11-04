function crmNetworkFetch(input,options={}){
 const timeout=AbortSignal.timeout(15000);
 const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
 return fetch(input,{...options,signal});
}
/* Listas locais: nenhuma leitura periódica da base de clientes/visitas. */
let crmOutboxSerial=0;
function crmOrderOutbox(items){return items.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)) || (a.queuedOrder||0)-(b.queuedOrder||0));}
let crmRefreshPromise = null;
let crmManifest = null;
let crmChannels = [];
let crmNotificationScope = '';
let crmPendingReservations = new Set();
let crmNoticeGeneration=0;
function crmRecordEvent(id,revision){
  state.crmAppliedRevisions ||= {};state.crmPendingRevisions ||= {};
  if((state.crmAppliedRevisions[id]||0)>=revision)return;
  crmPendingReservations.add(id);crmNoticeGeneration++;
  state.crmPendingRevisions[id]=Math.max(state.crmPendingRevisions[id]||0,revision);
}
function crmMarkApplied(ids){
  state.crmAppliedRevisions ||= {};
  for(const id of ids)state.crmAppliedRevisions[id]=state.crmPendingRevisions?.[id]||0;
}
let crmWrites = new Set();
let crmReadTables = new Set();
const CRM_TABLES = ['customers','visits','reservations','app_users','app_settings'];
function crmScopeHouses() {
  if(!state.currentUser) return [];
  const user = state.users.find(u=>u.id===state.currentUser);
  const allowed = getUserHouses(user).filter(h=>h!=='all');
  const selected = normalizeHouseKey(getSessionHouse() || 'all');
  return selected!=='all' && allowed.includes(selected) ? [selected] : allowed;
}
function crmScopeKey(){return state.currentUser + ':' + crmScopeHouses().join('|');}
function crmShouldPull(table){
  return !crmManifest || !state.crmCache || state.crmCache.scope!==crmScopeKey() || state.crmCache.versions[table]!==crmManifest[table];
}
function crmMarkRead(table,ok){if(ok) crmReadTables.add(table); else throw new Error('Não foi possível atualizar '+table);}
function crmTrackWrite(work) {
  const task = Promise.resolve().then(work);
  crmWrites.add(task);
  task.catch(error=>toast(error.message||'Falha ao preservar a gravação.','warn'));
  task.finally(()=>crmWrites.delete(task)).catch(()=>{});
  return task;
}
function dbSyncCustomer(c){return crmTrackWrite(async()=>{
  if(!c)return;if(!isUUID(c.id))c.id=generateUUID();
  await addToOutbox('UPSERT_CUSTOMER',structuredClone(c));
  if(navigator.onLine) await processOutboxQueue();
});}
function dbSyncVisit(v){return crmTrackWrite(async()=>{
  if(!v)return;if(!isUUID(v.id))v.id=generateUUID();
  crmVaultSaveVisit(v);
  await addToOutbox('INSERT_VISIT',structuredClone(v));
  if(navigator.onLine) await processOutboxQueue();
});}
function dbSyncReservation(r){if(r){if(!isUUID(r.id))r.id=generateUUID();crmVaultSaveReservation(r);}return crmTrackWrite(()=>dbSyncReservationImmediate(r));}
function dbDeleteReservation(id){if(id)crmVaultRemoveReservation(id);return crmTrackWrite(()=>dbDeleteReservationImmediate(id));}
async function crmVersions(){
  const {data,error}=await getSupabase().from('bravo_data_versions').select('table_name,version').in('table_name',CRM_TABLES);
  if(error || !data || data.length!==CRM_TABLES.length) throw new Error('Não foi possível verificar a versão dos dados. A lista local foi mantida.');
  return Object.fromEntries(data.map(r=>[r.table_name,r.version]));
}
async function pullAllFromSupabase() {
  if(!state.currentUser || new URLSearchParams(location.search).has('public')) return;
  if(crmRefreshPromise) return crmRefreshPromise;
  crmRefreshPromise=(async()=>{
    if(!navigator.onLine) throw new Error('Sem conexão. A lista local continua disponível.');
    await Promise.allSettled([...crmWrites]);
    await processOutboxQueue();
    // Permite atualizar a lista local mesmo se houver itens aguardando nova tentativa na Outbox (eles são preservados no merge)
    const noticeGeneration=crmNoticeGeneration;
    crmManifest=await crmVersions();
    crmReadTables=new Set();
    const scope=crmScopeKey();
    const prior=state.crmCache && state.crmCache.scope===scope ? state.crmCache.versions : {};
    await pullAllFromSupabaseLegacy();
    const versions={...prior};
    for(const table of crmReadTables) versions[table]=crmManifest[table];
    state.crmCache={scope,versions,lastRefresh:new Date().toISOString()};
    // Only persist metadata together with the list it describes.
    saveStateToStorage();
    if(crmNoticeGeneration===noticeGeneration){crmMarkApplied([...crmPendingReservations]);crmPendingReservations.clear();}
    state.crmPendingReservationIds=[...crmPendingReservations];
    saveStateToStorage();
    crmRenderStatus();
  })().catch(error=>{toast(error.message || 'Falha na atualização. Lista local mantida.','warn');throw error;}).finally(()=>{crmManifest=null;crmRefreshPromise=null;});
  return crmRefreshPromise;
}
async function crmManualRefresh(){
  try {
    if(state){
      delete state.crmCache;
      state.__visitsPurgedV2 = false;
      state.__syncRev = '2026-10-16-v4';
    }
    await pullAllFromSupabase();
    toast('Dados sincronizados com o banco.');
  } catch(e){
    toast('Erro ao atualizar: ' + (e.message || e), 'warn');
  }
}
function crmRenderStatus(){
  const stamp=document.getElementById('crmLastRefresh');
  if(stamp) stamp.textContent=state.crmCache?.lastRefresh ? 'Última atualização: '+new Date(state.crmCache.lastRefresh).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : 'Lista local — aguardando atualização';
  const notice=document.getElementById('crmReservationNotice');
  if(notice) notice.style.display=crmPendingReservations.size?'block':'none';
}
function crmDeferReservations(){
  const node=document.getElementById('crmReservationPending');
  if(node) node.textContent=' Atualização pendente. Você pode atualizar quando desejar.';
}
async function crmAcceptReservations(){
  // The journal also records deletes and moves between houses/dates.
  const ids=[...crmPendingReservations];
  const noticeGeneration=crmNoticeGeneration;
  try {
    const pending=await getOutboxItems();
    const protectedIds=new Set(pending.filter(i=>/RESERVATION/.test(i.action)).map(i=>i.payload.id));
    const updated=[];
    for(let i=0;i<ids.length;i+=100){
      let query=getSupabase().from('reservations').select('*').in('id',ids.slice(i,i+100));
      const houses=crmScopeHouses();
      if(houses.length) query=query.in('house',houses);
      const {data,error}=await query;
      if(error) throw error;
      updated.push(...data);
    }
    const changed=new Set(ids.filter(id=>!protectedIds.has(id)));
    state.reservations=state.reservations.filter(r=>!changed.has(r.id));
    for(const row of updated) if(!protectedIds.has(row.id)) state.reservations.push(crmMapReservation(row));
    if(crmNoticeGeneration===noticeGeneration){crmMarkApplied([...changed]);for(const id of changed)crmPendingReservations.delete(id);}
    state.crmPendingReservationIds=[...crmPendingReservations];
    if(state.crmCache) state.crmCache.lastRefresh=new Date().toISOString();
    saveStateToStorage();renderReservations();crmRenderStatus();
  } catch(error){toast('Não foi possível atualizar as reservas. Tente novamente.','warn');}
}
function crmMapReservation(rr){
  const tag=(name)=>{const match=String(rr.notes||'').match(new RegExp('\\['+name+':([^\\]]*)\\]'));return match?match[1].trim():'';};
  return {id:rr.id,customerId:rr.customer_id,name:rr.customer_name,phone:rr.customer_phone,house:rr.house,date:rr.reservation_date,time:rr.reservation_time,people:rr.people_count,status:rr.status,notes:rr.notes||'',source:rr.source||tag('ORIGEM')||'Da casa',priorities:tag('PRIORIDADE').split(',').map(s=>s.trim()).filter(Boolean),createdAt:rr.created_at?.slice(0,10)||tag('CRIADA_EM')||rr.reservation_date,exceptionReason:tag('EXCEÇÃO')};
}
async function crmCheckReservationEvents(house){
  const key=house+'|'+today();
  state.crmEventCursors ||= {};
  let cursor=state.crmEventCursors[key];
  if(cursor===undefined) {
    const {data,error}=await getSupabase().from('crm_reservation_events').select('id').eq('house',house).eq('reservation_date',today()).order('id',{ascending:false}).limit(1);
    if(error) throw error;
    state.crmEventCursors[key]=data[0]?.id||0;
    saveStateToStorage();return;
  }
  for(;;){
    const {data,error}=await getSupabase().from('crm_reservation_events').select('id,reservation_id').eq('house',house).eq('reservation_date',today()).gt('id',cursor).order('id').limit(500);
    if(error) throw error;
    for(const event of data) {crmRecordEvent(event.reservation_id,event.id);cursor=event.id;}
    state.crmEventCursors[key]=cursor;
    if(data.length<500) break;
  }
  // Pending IDs must survive F5 even after advancing the recovery cursor.
  state.crmPendingReservationIds=[...crmPendingReservations];
  saveStateToStorage();crmRenderStatus();
}
function crmStopNotifications(){
  const sb=getSupabase();for(const channel of crmChannels) sb.removeChannel(channel);
  crmChannels=[];crmNotificationScope='';
}
async function crmStartNotifications(){
  if(!state.currentUser) return;
  const scope=crmScopeKey()+'|'+today();
  if(scope===crmNotificationScope) return;
  crmStopNotifications();crmNotificationScope=scope;
  const sb=getSupabase();
  for(const house of crmScopeHouses()){
    await crmCheckReservationEvents(house);
    const channel=sb.channel('crm-reservations:'+house+':'+today(),{config:{private:false}})
      .on('broadcast',{event:'changed'},message=>{
        const id=message.payload?.reservation_id;
        if(!id)return;
        crmRecordEvent(id,message.payload.revision||Date.now());
        state.crmPendingReservationIds=[...crmPendingReservations];
        saveStateToStorage();crmRenderStatus();
      })
      .subscribe(status=>{if(status==='SUBSCRIBED') crmCheckReservationEvents(house).catch(()=>{});});
    crmChannels.push(channel);
  }
}
let isAutoFlushingLocalData = false;
const CRM_VAULT_LS_KEY = 'qu4tro_immutable_vault_v1';
let _crmVaultDbPromise = null;
function openCrmVaultDB(){
  if(_crmVaultDbPromise) return _crmVaultDbPromise;
  if(typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null);
  _crmVaultDbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open('Qu4troCRM_Vault_DB', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if(!db.objectStoreNames.contains('vault_records')){
          db.createObjectStore('vault_records', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch(_){ resolve(null); }
  });
  return _crmVaultDbPromise;
}
function _crmReadVaultLS(){
  try {
    const raw = localStorage.getItem(CRM_VAULT_LS_KEY);
    return raw ? JSON.parse(raw) : { visits: {}, reservations: {} };
  } catch(_){ return { visits: {}, reservations: {} }; }
}
function _crmWriteVaultLS(vaultObj){
  try {
    // Limpa registros já confirmados há mais de 60 dias para manter uso de disco mínimo
    const cutoff = new Date(Date.now() - 60 * 86400000).toISOString();
    for(const bucket of ['visits', 'reservations']){
      const map = vaultObj[bucket] || {};
      for(const k of Object.keys(map)){
        if(map[k] && map[k].confirmedInCloud && (map[k].savedAt || '') < cutoff){
          delete map[k];
        }
      }
    }
    localStorage.setItem(CRM_VAULT_LS_KEY, JSON.stringify(vaultObj));
  } catch(_){}
}
function crmVaultSaveVisit(v){
  if(!v || !v.id || isLegacySeedVisit(v)) return;
  const entry = { key: 'visit:' + v.id, id: String(v.id), type: 'visit', record: structuredClone(v), confirmedInCloud: !!v.syncedToSupabase, savedAt: new Date().toISOString() };
  const ls = _crmReadVaultLS();
  ls.visits ||= {};
  if(!ls.visits[entry.id] || !ls.visits[entry.id].confirmedInCloud || !v.syncedToSupabase){
    ls.visits[entry.id] = entry;
    _crmWriteVaultLS(ls);
  }
  openCrmVaultDB().then(db => {
    if(!db) return;
    try {
      const tx = db.transaction('vault_records', 'readwrite');
      tx.objectStore('vault_records').put(entry);
    } catch(_){}
  });
}
function crmVaultConfirmVisit(visitId){
  if(!visitId) return;
  const id = String(visitId);
  const ls = _crmReadVaultLS();
  if(ls.visits && ls.visits[id]){
    ls.visits[id].confirmedInCloud = true;
    ls.visits[id].confirmedAt = new Date().toISOString();
    if(ls.visits[id].record) ls.visits[id].record.syncedToSupabase = true;
    _crmWriteVaultLS(ls);
  }
  openCrmVaultDB().then(db => {
    if(!db) return;
    try {
      const tx = db.transaction('vault_records', 'readwrite');
      const store = tx.objectStore('vault_records');
      const g = store.get('visit:' + id);
      g.onsuccess = () => {
        if(g.result){
          g.result.confirmedInCloud = true;
          g.result.confirmedAt = new Date().toISOString();
          if(g.result.record) g.result.record.syncedToSupabase = true;
          store.put(g.result);
        }
      };
    } catch(_){}
  });
}
function crmVaultRemoveVisit(visitId){
  if(!visitId) return;
  const id = String(visitId);
  if(typeof state !== 'undefined' && state){
    state.deletedVisits ||= [];
    if(!state.deletedVisits.includes(id)) state.deletedVisits.push(id);
  }
  const ls = _crmReadVaultLS();
  if(ls.visits && ls.visits[id]){
    delete ls.visits[id];
    _crmWriteVaultLS(ls);
  }
  openCrmVaultDB().then(db => {
    if(!db) return;
    try {
      const tx = db.transaction('vault_records', 'readwrite');
      tx.objectStore('vault_records').delete('visit:' + id);
    } catch(_){}
  });
}
function crmVaultSaveReservation(r){
  if(!r || !r.id) return;
  const entry = { key: 'res:' + r.id, id: String(r.id), type: 'reservation', record: structuredClone(r), confirmedInCloud: false, savedAt: new Date().toISOString() };
  const ls = _crmReadVaultLS();
  ls.reservations ||= {};
  ls.reservations[entry.id] = entry;
  _crmWriteVaultLS(ls);
  openCrmVaultDB().then(db => {
    if(!db) return;
    try {
      const tx = db.transaction('vault_records', 'readwrite');
      tx.objectStore('vault_records').put(entry);
    } catch(_){}
  });
}
function crmVaultConfirmReservation(resId){
  if(!resId) return;
  const id = String(resId);
  const ls = _crmReadVaultLS();
  if(ls.reservations && ls.reservations[id]){
    ls.reservations[id].confirmedInCloud = true;
    ls.reservations[id].confirmedAt = new Date().toISOString();
    _crmWriteVaultLS(ls);
  }
  openCrmVaultDB().then(db => {
    if(!db) return;
    try {
      const tx = db.transaction('vault_records', 'readwrite');
      const store = tx.objectStore('vault_records');
      const g = store.get('res:' + id);
      g.onsuccess = () => {
        if(g.result){
          g.result.confirmedInCloud = true;
          g.result.confirmedAt = new Date().toISOString();
          store.put(g.result);
        }
      };
    } catch(_){}
  });
}
function crmVaultRemoveReservation(resId){
  if(!resId) return;
  const id = String(resId);
  const ls = _crmReadVaultLS();
  if(ls.reservations && ls.reservations[id]){
    delete ls.reservations[id];
    _crmWriteVaultLS(ls);
  }
  openCrmVaultDB().then(db => {
    if(!db) return;
    try {
      const tx = db.transaction('vault_records', 'readwrite');
      tx.objectStore('vault_records').delete('res:' + id);
    } catch(_){}
  });
}
async function _crmVaultGetAllEntries(){
  const ls = _crmReadVaultLS();
  const map = new Map();
  for(const v of Object.values(ls.visits || {})) if(v && v.key) map.set(v.key, v);
  for(const r of Object.values(ls.reservations || {})) if(r && r.key) map.set(r.key, r);
  const db = await openCrmVaultDB();
  if(db){
    await new Promise(resolve => {
      try {
        const tx = db.transaction('vault_records', 'readonly');
        const req = tx.objectStore('vault_records').getAll();
        req.onsuccess = () => {
          for(const item of (req.result || [])){
            if(!item || !item.key) continue;
            const prev = map.get(item.key);
            if(!prev || (item.confirmedInCloud && !prev.confirmedInCloud)){
              map.set(item.key, item);
            }
          }
          resolve();
        };
        req.onerror = () => resolve();
      } catch(_){ resolve(); }
    });
  }
  return Array.from(map.values());
}
async function crmVaultGetUnconfirmedVisits(){
  const deletedSet = new Set((typeof state !== 'undefined' && state && Array.isArray(state.deletedVisits)) ? state.deletedVisits.map(String) : []);
  const all = await _crmVaultGetAllEntries();
  return all.filter(e => e.type === 'visit' && !e.confirmedInCloud && e.record && !deletedSet.has(String(e.id)) && !isLegacySeedVisit(e.record)).map(e => {
    e.record.syncedToSupabase = false;
    return e.record;
  });
}
async function crmVaultGetUnconfirmedReservations(){
  const all = await _crmVaultGetAllEntries();
  return all.filter(e => e.type === 'reservation' && !e.confirmedInCloud && e.record).map(e => e.record);
}
window.crmVaultSaveVisit = crmVaultSaveVisit;
window.crmVaultConfirmVisit = crmVaultConfirmVisit;
window.crmVaultRemoveVisit = crmVaultRemoveVisit;
window.crmVaultSaveReservation = crmVaultSaveReservation;
window.crmVaultConfirmReservation = crmVaultConfirmReservation;
window.crmVaultRemoveReservation = crmVaultRemoveReservation;
window.crmVaultGetUnconfirmedVisits = crmVaultGetUnconfirmedVisits;
window.crmVaultGetUnconfirmedReservations = crmVaultGetUnconfirmedReservations;

async function crmSaveCustomerAutoResolve(sb, payload, c){
  let { data, error } = await sb.rpc('crm_save_customer', { payload, expected_updated_at: (c && c.serverUpdatedAt) ? c.serverUpdatedAt : null });
  if(!error) return { data, error: null };
  // Resolução automática de conflito de concorrência (40001) ou chave única de ID/telefone (23505)
  try {
    let remote = null;
    if(payload.id){
      const byId = await sb.from('customers').select('*').eq('id', payload.id).maybeSingle();
      if(byId && byId.data) remote = byId.data;
    }
    if(!remote && payload.phone && payload.phone !== '0'){
      const byPhone = await sb.from('customers').select('*').eq('phone', payload.phone).limit(1);
      if(byPhone && byPhone.data && byPhone.data.length > 0) remote = byPhone.data[0];
    }
    if(remote){
      const oldId = payload.id;
      payload.id = remote.id;
      payload.total_visits = Math.max(+payload.total_visits || 1, +remote.total_visits || 1);
      payload.visits_lena = Math.max(+payload.visits_lena || 0, +remote.visits_lena || 0);
      payload.visits_iconiko = Math.max(+payload.visits_iconiko || 0, +remote.visits_iconiko || 0);
      payload.visits_cafe = Math.max(+payload.visits_cafe || 0, +remote.visits_cafe || 0);
      payload.first_visit = (remote.first_visit && (!payload.first_visit || remote.first_visit < payload.first_visit)) ? remote.first_visit : (payload.first_visit || remote.first_visit);
      payload.last_visit = (remote.last_visit && (!payload.last_visit || remote.last_visit > payload.last_visit)) ? remote.last_visit : (payload.last_visit || remote.last_visit);
      payload.first_house = remote.first_house || payload.first_house || '';
      if(c) c.id = remote.id;
      if(typeof state !== 'undefined' && state && Array.isArray(state.clients)){
        const localC = state.clients.find(x => x.id === oldId || x.id === remote.id);
        if(localC) localC.id = remote.id;
      }
      const retry = await sb.rpc('crm_save_customer', { payload, expected_updated_at: remote.updated_at });
      if(!retry.error) return { data: retry.data, error: null };
      const up = await sb.from('customers').upsert(payload, { onConflict: 'id' }).select('*').maybeSingle();
      if(!up.error) return { data: up.data || { updated_at: new Date().toISOString() }, error: null };
    } else {
      const retryNull = await sb.rpc('crm_save_customer', { payload, expected_updated_at: null });
      if(!retryNull.error) return { data: retryNull.data, error: null };
      const up = await sb.from('customers').upsert(payload, { onConflict: 'id' }).select('*').maybeSingle();
      if(!up.error) return { data: up.data || { updated_at: new Date().toISOString() }, error: null };
    }
  } catch(_){}
  return { data, error };
}
window.crmSaveCustomerAutoResolve = crmSaveCustomerAutoResolve;
function isLegacySeedVisit(v){
  if(!v) return true;
  const vid = String(v.id || '');
  if(vid.startsWith('Í-') || vid.startsWith('L-') || vid.startsWith('I-')) return true;
  const d = (typeof normalizeDateIso === 'function') ? (normalizeDateIso(v.date) || v.date || '') : String(v.date || '');
  if(d && d < '2026-10-01') return true;
  return false;
}
function isLegacySeedClient(c){
  if(!c) return true;
  const cid = String(c.id || '');
  if(/^C-\d{1,6}$/.test(cid)) return true;
  const d = String(c.lastVisit || c.firstVisit || '');
  if(d && d < '2026-10-01') return true;
  return false;
}
async function crmAutoFlushLocalData(){
  if(isAutoFlushingLocalData) return;
  if(typeof state === 'undefined' || !state || !state.currentUser) return;
  if(typeof navigator !== 'undefined' && !navigator.onLine) {
    console.log('[AutoSync] Dispositivo offline. Sincronização automática aguardará conexão.');
    return;
  }
  const sb = (typeof getSupabase === 'function') ? getSupabase() : null;
  if(!sb) return;

  isAutoFlushingLocalData = true;
  let syncedVisits = 0;
  let syncedCustomers = 0;

  try {
    // 1. Processa imediatamente qualquer item pendente na fila Outbox (IndexedDB e LocalStorage)
    if(typeof processOutboxQueue === 'function'){
      if(typeof getOutboxItems === 'function'){ try { const ob = await getOutboxItems(); for(const item of ob){ if(item && item.blocked){ item.blocked = false; await crmSaveOutboxItem(item); } } } catch(_){} }
      await processOutboxQueue();
    }
    if(typeof state !== 'undefined' && state){
      state.visits ||= [];
      const deletedSet = new Set(Array.isArray(state.deletedVisits) ? state.deletedVisits.map(String) : []);
      if(Array.isArray(state.waitlist) && state.waitlist.length > 0){
        for(const w of state.waitlist){
          if(!w || w.status !== 'Atendido' || !w.createdAt || w.syncedVisitToSupabase === true) continue;
          try {
            const wParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(w.createdAt)).map(p => [p.type, p.value]));
            const wDateIso = wParts.year + '-' + wParts.month + '-' + wParts.day;
            if(!wDateIso || wDateIso < '2026-10-01') continue;
            const wPhone = (typeof normalizePhone === 'function') ? normalizePhone(w.phone) : String(w.phone || '').replace(/\D/g, '');
            const wHouse = (typeof normalizeHouseKey === 'function') ? normalizeHouseKey(w.house) : (w.house || '');
            const existsLocal = state.visits.some(v => {
              if(!v) return false;
              const vPhone = (typeof normalizePhone === 'function') ? normalizePhone(v.phone) : String(v.phone || '').replace(/\D/g, '');
              const vHouse = (typeof normalizeHouseKey === 'function') ? normalizeHouseKey(v.house) : (v.house || '');
              const vDate = (typeof normalizeDateIso === 'function') ? (normalizeDateIso(v.date) || v.date) : v.date;
              return vHouse === wHouse && vDate === wDateIso && vPhone === wPhone;
            });
            if(!existsLocal){
              const waitMins = w.waitDurationMinutes || 1;
              const recVisit = {
                id: (typeof generateUUID === 'function') ? generateUUID() : ('V-' + Date.now()),
                customer_id: (w.clientId && typeof isUUID === 'function' && isUUID(w.clientId)) ? w.clientId : null,
                customerId: (w.clientId && typeof isUUID === 'function' && isUUID(w.clientId)) ? w.clientId : null,
                date: wDateIso,
                house: w.house || wHouse,
                name: w.name || 'Cliente Fila',
                people: +w.people || 1,
                phone: w.phone || '',
                arrival: w.timeRegistered || w.seatedAt || '20:00',
                departure: '',
                source: 'Fila de Espera',
                status: 'Recorrente',
                houseStatus: 'Recorrente',
                table: w.table || '',
                notes: ('[Fila: ' + waitMins + ' min] ' + (w.notes || '')).trim(),
                amount: 0,
                operatorReception: w.house || 'Recepção',
                syncedToSupabase: false,
                _waitlistRefId: w.id
              };
              state.visits.unshift(recVisit);
              crmVaultSaveVisit(recVisit);
            } else {
              w.syncedVisitToSupabase = true;
            }
          } catch(_){}
        }
      }
      const vaultUnconfirmed = await crmVaultGetUnconfirmedVisits();
      for(const vv of vaultUnconfirmed){
        if(!vv || !vv.id || deletedSet.has(String(vv.id))) continue;
        if(!state.visits.some(x => x && x.id === vv.id)){
          state.visits.unshift(vv);
        }
      }
    }

    // 2. Varrer state.visits para identificar e enviar visitas locais que ainda não estão no Supabase
    if(typeof state !== 'undefined' && state && Array.isArray(state.visits) && state.visits.length > 0){
      const pendingVisits = state.visits.filter(v => v && v.syncedToSupabase !== true && !isLegacySeedVisit(v));

      if(pendingVisits.length > 0){
        console.log(`[AutoSync] Verificando ${pendingVisits.length} visita(s) pendente(s) no cache local...`);

        for(const v of pendingVisits){
          try {
            // Garante que o ID da visita é um UUID válido
            const validUUID = (typeof isUUID === 'function' && isUUID(v.id)) ? v.id : ((typeof generateUUID === 'function') ? generateUUID() : null);
            if(validUUID && v.id !== validUUID) v.id = validUUID;

            const cleanPhone = (typeof normalizePhone === 'function') ? normalizePhone(v.phone) : String(v.phone || '').replace(/\D/g, '');
            const visitDate = (typeof normalizeDateIso === 'function') ? (normalizeDateIso(v.date) || v.date) : (v.date || (typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10)));

            // Verifica se a visita já existe no Supabase por ID
            let alreadyInDB = false;
            try {
              if(v.id){
                const { data: existingById } = await sb.from('visits').select('id').eq('id', v.id).maybeSingle();
                if(existingById && existingById.id){
                  alreadyInDB = true;
                }
              }
            } catch(_){}

            // Se não encontrou por ID, confere por assinatura única (casa + data + telefone + horário de chegada)
            if(!alreadyInDB && cleanPhone && v.house && visitDate){
              try {
                let sigQuery = sb.from('visits').select('id')
                  .eq('house', v.house)
                  .eq('visit_date', visitDate)
                  .eq('customer_phone', cleanPhone);
                if(v.arrival) sigQuery = sigQuery.eq('arrival_time', v.arrival);
                const { data: existingBySig } = await sigQuery.limit(1);
                if(existingBySig && existingBySig.length > 0){
                  alreadyInDB = true;
                  v.id = existingBySig[0].id;
                }
              } catch(_){}
            }

            if(!alreadyInDB){
              // Não existe no Supabase: ENVIA IMEDIATAMENTE DE FORMA AUTOMÁTICA!
              const payload = {
                id: v.id,
                customer_id: (typeof isUUID === 'function' && isUUID(v.customerId || v.customer_id)) ? (v.customerId || v.customer_id) : null,
                customer_name: v.name || '',
                customer_phone: cleanPhone,
                house: v.house || '',
                visit_date: visitDate,
                arrival_time: v.arrival || '',
                people_count: +v.people || 1,
                table_number: String(v.table || ''),
                source: v.source || 'Walk-in',
                status: v.status || 'Atendido',
                amount: +v.amount || 0,
                notes: v.notes || '',
                operator_reception: v.operatorReception || ''
              };

              let { error } = await sb.rpc('crm_save_visit', { payload });
              if (error && (error.code === '23503' || (error.message && error.message.includes('foreign key')))) {
                payload.customer_id = null;
                const retry = await sb.rpc('crm_save_visit', { payload });
                error = retry.error;
              }

              if(!error){
                v.syncedToSupabase = true;
              crmVaultConfirmVisit(v.id);
              if(v._waitlistRefId && Array.isArray(state.waitlist)){ const wRef = state.waitlist.find(x => x && x.id === v._waitlistRefId); if(wRef) wRef.syncedVisitToSupabase = true; }
                crmVaultConfirmVisit(v.id);
                if(v._waitlistRefId && Array.isArray(state.waitlist)){ const wRef = state.waitlist.find(x => x && x.id === v._waitlistRefId); if(wRef) wRef.syncedVisitToSupabase = true; }
                syncedVisits++;
                console.log(`[AutoSync] Visita de ${v.name} enviada e confirmada no Supabase!`);
              } else {
                console.warn(`[AutoSync] Falha ao enviar visita de ${v.name}:`, error);
                if(typeof addToOutbox === 'function'){
                  await addToOutbox('INSERT_VISIT', structuredClone(v));
                }
              }
            } else {
              // Já consta no banco, marca como sincronizada
              v.syncedToSupabase = true;
              crmVaultConfirmVisit(v.id);
              if(v._waitlistRefId && Array.isArray(state.waitlist)){ const wRef = state.waitlist.find(x => x && x.id === v._waitlistRefId); if(wRef) wRef.syncedVisitToSupabase = true; }
            }
          } catch(itemErr){
            console.warn('[AutoSync] Erro individual ao sincronizar visita:', itemErr);
          }
        }
      }
    }

    // 2.5 Reconciliar reservas pendentes no Cofre Local Blindado
    try {
      const vaultRes = await crmVaultGetUnconfirmedReservations();
      for(const r of vaultRes){
        if(!r || !r.id) continue;
        let finalNotes = r.notes || '';
        if(r.source && r.source !== 'Da casa' && !finalNotes.includes('[ORIGEM:')) finalNotes = '[ORIGEM: ' + r.source + '] ' + finalNotes;
        if(r.exceptionReason && !finalNotes.includes('[EXCEÇÃO')) finalNotes = '[EXCEÇÃO: ' + r.exceptionReason + '] ' + finalNotes;
        if(r.priorities && r.priorities.length && !finalNotes.includes('[PRIORIDADE:')) finalNotes = '[PRIORIDADE: ' + r.priorities.join(', ') + '] ' + finalNotes;
        const rPayload = {
          id: r.id,
          customer_id: (typeof isUUID === 'function' && isUUID(r.customerId || r.customer_id)) ? (r.customerId || r.customer_id) : null,
          customer_name: r.name || '',
          customer_phone: (typeof digits === 'function') ? (digits(r.phone) || '') : String(r.phone || '').replace(/\D/g, ''),
          house: r.house || '',
          reservation_date: r.date,
          reservation_time: r.time || '',
          people_count: +r.people || 1,
          status: r.status || 'Pendente',
          notes: finalNotes
        };
        let { error: rErr } = await sb.rpc('crm_save_reservation', { payload: rPayload });
        if(rErr && (rErr.code === '23503' || (rErr.message && rErr.message.includes('foreign key')))){
          rPayload.customer_id = null;
          const retryR = await sb.rpc('crm_save_reservation', { payload: rPayload });
          rErr = retryR.error;
        }
        if(!rErr){
          crmVaultConfirmReservation(r.id);
          syncedVisits++;
        }
      }
    } catch(_){}

    // 3. Varrer state.clients para sincronizar clientes locais criados sem confirmação de nuvem
    if(typeof state !== 'undefined' && state && Array.isArray(state.clients) && state.clients.length > 0){
      const unconfirmedClients = state.clients.filter(c => c && !c.serverUpdatedAt && !isLegacySeedClient(c));
      for(const c of unconfirmedClients){
        try {
          if(typeof isUUID === 'function' && !isUUID(c.id)){
            c.id = (typeof generateUUID === 'function') ? generateUUID() : c.id;
          }
          const cleanPhone = (typeof digits === 'function') ? (digits(c.phone) || '0') : String(c.phone||'').replace(/\D/g, '');
          const payload = {
            id: c.id,
            name: c.name,
            phone: cleanPhone,
            email: c.email || null,
            first_house: c.firstHouse || '',
            first_visit: c.firstVisit || null,
            last_visit: c.lastVisit || null,
            total_visits: +c.totalVisits || 1,
            visits_lena: +c.lena || 0,
            visits_iconiko: +c.iconico || 0,
            visits_cafe: +c.cafe || 0,
            source: c.source || 'Da casa',
            registration_channel: c.registrationChannel || 'Recepção',
            preferences: JSON.stringify({ priorities: c.priorities || [] }),
            notes: c.notes || ''
          };
          const { data, error } = await crmSaveCustomerAutoResolve(sb, payload, c);
          if(!error && data){
            c.serverUpdatedAt = data.updated_at;
            syncedCustomers++;
          }
        } catch(_){}
      }
    }

    // 4. Salvar estado local e notificar se houve envios
    const totalSynced = syncedVisits + syncedCustomers;
    if(totalSynced > 0){
      if(typeof saveFast === 'function') saveFast();
      else if(typeof saveStateToStorage === 'function') saveStateToStorage();
      
      const msg = `✓ Sincronização automática: ${totalSynced} registro(s) pendente(s) do cache local gravado(s) na nuvem!`;
      if(typeof toast === 'function') toast(msg, 'success');
      console.log(`[AutoSync] ${msg}`);

      if(typeof renderCheckinStats === 'function') renderCheckinStats();
      if(typeof renderCheckinList === 'function') renderCheckinList();
    }
  } catch(err){
    console.warn('[AutoSync] Exceção na rotina automática de reconciliação:', err);
  } finally {
    isAutoFlushingLocalData = false;
    if(typeof updateSyncStatusUI === 'function') updateSyncStatusUI();
  }
}
window.crmAutoFlushLocalData = crmAutoFlushLocalData;

async function crmStartSession(){
  if(!state.currentUser) return;
  crmPendingReservations=new Set(state.crmPendingScope===crmScopeKey() ? (state.crmPendingReservationIds||[]) : []);
  state.crmPendingScope=crmScopeKey();
  try {
    await crmAutoFlushLocalData();
    await crmStartNotifications();
    await pullAllFromSupabase();
    if(state.crmCache?.scope!==crmScopeKey())await pullAllFromSupabase();
    for(const house of crmScopeHouses()) await crmCheckReservationEvents(house);
  } catch(_){}
}
function crmScheduleInfo(date=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return {day:parts.year+'-'+parts.month+'-'+parts.day,minute:Number(parts.hour)*60+Number(parts.minute)};
}
async function crmDailyTick(){
  if(!state.currentUser || !navigator.onLine) return;
  const now=crmScheduleInfo();
  state.crmDailyRefresh ||= {};
  const due=crmScopeHouses().map(house=>({house,key:house+'|'+now.day,minute:/Café/.test(house)?435:1095})).filter(item=>now.minute>=item.minute && !state.crmDailyRefresh[item.key]);
  if(due.length){
    try{await pullAllFromSupabase();for(const item of due)state.crmDailyRefresh[item.key]=true;saveStateToStorage();}catch(_){}
  }
  crmStartNotifications().catch(()=>{});
}
async function crmFlushBeforeLogout(){
  await Promise.allSettled([...crmWrites]);
  await processOutboxQueue();
  const deadline=Date.now()+45000;
  while(isOutboxProcessing && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,100));
  const remaining=await getOutboxItems();
  if(remaining.length || isOutboxProcessing){toast('Há dados que ainda não foram enviados. A sessão foi mantida; tente novamente quando houver conexão.','warn');return false;}
  return true;
}
document.addEventListener('DOMContentLoaded',()=>{
  crmStartSession();crmRenderStatus();crmShowConflictNotice();
  crmAutoFlushLocalData();
  // This timer checks only the device clock; it makes no periodic database reads.
  setInterval(crmDailyTick,60000);
  setInterval(()=>{if(typeof navigator!=='undefined' && navigator.onLine && state?.currentUser) crmAutoFlushLocalData();}, 120000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){crmDailyTick();crmAutoFlushLocalData();}});
});
window.addEventListener('online',()=>{
  console.log('[AutoSync] Conexão detectada. Executando sincronização automática do cache...');
  crmAutoFlushLocalData();
});

async function crmSaveOutboxItem(item){
  const db=await openOutboxDB();
  if(db) await new Promise((resolve,reject)=>{const tx=db.transaction('outbox','readwrite');tx.objectStore('outbox').put(item);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  const queue=JSON.parse(localStorage.getItem('qu4tro_outbox_queue_v1')||'[]');
  const at=queue.findIndex(i=>i.id===item.id);
  if(at!==-1){queue[at]=item;localStorage.setItem('qu4tro_outbox_queue_v1',JSON.stringify(queue));}
}
async function crmShowConflictNotice(){
  const node=document.getElementById('crmConflictNotice');
  if(node) node.style.display='none';
}
async function crmReviewConflicts(){
  for(const item of (await getOutboxItems()).filter(i=>i.blocked && i.action==='UPSERT_CUSTOMER')){
    let {data:remote,error}=await getSupabase().from('customers').select('id,name,phone,email,updated_at').eq('id',item.payload.id).maybeSingle();
    if(error){toast('Não foi possível consultar o cadastro atual. Tente novamente.','warn');return;}
    if(!remote){const found=await getSupabase().from('customers').select('id,name,phone,email,updated_at').eq('phone',digits(item.payload.phone)).maybeSingle();remote=found.data;}
    if(!remote){toast('Cadastro removido. A alteração foi preservada; confira o cliente na lista antes de cadastrar novamente.','warn');continue;}
    const draft=item.payload;
    if(confirm('Este cadastro foi alterado em outro atendimento.\n\nNo banco: '+remote.name+' — '+remote.phone+'\nSua edição: '+draft.name+' — '+draft.phone+'\n\nDeseja enviar sua edição sobre a versão atual?')){
      const previousId=item.payload.id;
      item.payload.id=remote.id;item.payload.serverUpdatedAt=remote.updated_at;item.blocked=false;
      if(previousId!==remote.id){
        for(const next of await getOutboxItems()){
          if(next.payload.customerId===previousId){next.payload.customerId=remote.id;await crmSaveOutboxItem(next);}
        }
        const local=state.clients.find(c=>c.id===previousId);if(local)local.id=remote.id;
      }
      await crmSaveOutboxItem(item);await processOutboxQueue();
    }
  }
  crmShowConflictNotice();
}
