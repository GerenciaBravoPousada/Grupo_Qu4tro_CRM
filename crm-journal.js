const crmJournalActions = new Set(['WAITLIST','INSERT_VISIT','DELETE_VISIT','UPSERT_RESERVATION','DELETE_RESERVATION']);
const crmJournalCalls = new Map();
let crmJournalDiscovered = false;
let crmJournalEnabled = false;
let crmJournalWarning = '';
let crmJournalExpiring = 0;

window.addEventListener('message', event => {
  if(event.source !== window || event.origin !== location.origin) return;
  if(event.data?.channel === 'qu4tro-journal-ready'){
    crmJournalEnabled = true;
    void crmJournalCheck();
    return;
  }
  if(event.data?.channel !== 'qu4tro-journal-response') return;
  crmJournalCalls.get(event.data.id)?.(event.data.response);
});

function crmJournalRequest(message){
  const id = crypto.randomUUID();
  return new Promise(resolve => {
    const finish = result => {
      clearTimeout(timer);
      crmJournalCalls.delete(id);
      if(result) crmJournalDiscovered = true;
      resolve(result?.ok ? result : null);
    };
    const timer = setTimeout(() => finish(null), crmJournalDiscovered ? 12000 : 2500);
    crmJournalCalls.set(id, finish);
    window.postMessage({channel:'qu4tro-journal-request',id,message}, location.origin);
  });
}

function crmJournalRender(){
  const node = document.getElementById('crmJournalNotice');
  if(!node) return;
  const messages = [crmJournalWarning];
  if(crmJournalExpiring) messages.push(crmJournalExpiring + ' operação(ões) sem confirmação atingirão 72 horas em até 12 horas.');
  node.textContent = messages.filter(Boolean).join(' ');
  node.hidden = !node.textContent;
}

async function crmJournalRecord(action, payload, id = crypto.randomUUID()){
  if(!crmJournalEnabled || !crmJournalActions.has(action) || !state.currentUser || new URLSearchParams(location.search).has('public')) return null;
  try {
    // Conservar os campos operacionais e evitar guardar nome/telefone quando já há cliente identificado.
    const details = {operatorId:state.currentUser, house:payload.house || getSessionHouse()};
    const clientId = payload.customerId || payload.customer_id || payload.clientId;
    const keys = ['id','status','date','time','arrival','people','house','table','source','notes','priority','priorities','preference','createdAt','timeRegistered','calledAt','seatedAt','waitDurationMinutes','cloudRevision','amount','reason','operatorReception','_waitlistRefId','arrivalTime','observations','exceptionReason','departure'];
    const record = Object.fromEntries(keys.filter(key => payload[key] !== undefined).map(key => [key,payload[key]]));
    if(clientId && isUUID(clientId)) record.customerId = clientId;
    else {
      if(payload.name) record.name = payload.name;
      if(payload.phone) record.phone = payload.phone;
    }
    const result = await crmJournalRequest({command:'append',id,action,details:{...details,record}});
    if(!result) throw new Error('Diário indisponível');
    crmJournalExpiring = result.expiring || 0;
    crmJournalRender();
    return id;
  } catch(error){
    crmJournalWarning = 'Uma operação ficou sem proteção do diário do Windows. Verifique o componente local.';
    crmJournalRender();
    return null;
  }
}

async function crmJournalConfirm(id){
  if(!id) return;
  const result = await crmJournalRequest({command:'confirm',id});
  if(result) crmJournalExpiring = result.expiring || 0;
  else crmJournalWarning = 'O Supabase recebeu uma operação, mas o diário local não conseguiu guardar a confirmação.';
  crmJournalRender();
}

async function crmJournalCheck(){
  if(!crmJournalEnabled || typeof state === 'undefined' || !state.currentUser || new URLSearchParams(location.search).has('public')) return;
  const result = await crmJournalRequest({command:'status'});
  if(result){
    crmJournalExpiring = result.expiring || 0;
    crmJournalRender();
  }
}

setInterval(crmJournalCheck, 60000);
window.addEventListener('focus', crmJournalCheck);

window.postMessage({channel:'qu4tro-journal-discover'}, location.origin);
