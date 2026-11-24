const crmJournalActions = new Set(['WAITLIST','INSERT_VISIT','DELETE_VISIT','UPSERT_RESERVATION','DELETE_RESERVATION']);
const crmJournalCalls = new Map();
let crmJournalDiscovered = false;
let crmJournalEnabled = false;
let crmJournalWarning = '';
let crmJournalExpiring = 0;
let crmJournalStorage = null;
let crmJournalSetupInProgress = false;

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
    const timer = setTimeout(() => finish(null), message.command === 'setup' ? 30000 : crmJournalDiscovered ? 12000 : 2500);
    crmJournalCalls.set(id, finish);
    window.postMessage({channel:'qu4tro-journal-request',id,message}, location.origin);
  });
}

function crmJournalRender(){
  const banner = document.getElementById('crmJournalBanner');
  const node = document.getElementById('crmJournalNotice');
  const button = document.getElementById('crmJournalSetupButton');
  if(!banner || !node || !button) return;
  const setupNeeded = crmJournalStorage === 'none' || crmJournalStorage === 'legacy';
  const message = crmJournalStorage === 'none'
    ? 'Diário inativo neste terminal.'
    : crmJournalStorage === 'legacy' ? 'Diário ativo na pasta anterior. Você pode conectá-lo à pasta padrão.' : '';
  const messages = [crmJournalWarning || message];
  if(crmJournalExpiring) messages.push(crmJournalExpiring + ' operação(ões) sem confirmação atingirão 72 horas em até 12 horas.');
  node.textContent = messages.filter(Boolean).join(' ');
  button.hidden = !setupNeeded || !state.currentUser;
  button.disabled = crmJournalSetupInProgress;
  button.textContent = crmJournalSetupInProgress ? 'Verificando backup…' : 'Criar backup';
  banner.hidden = !node.textContent && button.hidden;
}

async function crmJournalSetup(){
  if(!state.currentUser || crmJournalSetupInProgress) return;
  if(!crmJournalEnabled){
    await browserJournalQuickSetup();
    return;
  }
  if(!confirm('Criar ou reconectar o diário de 72 horas na pasta padrão do Windows?')) return;
  crmJournalSetupInProgress = true;
  crmJournalRender();
  try {
    const result = await crmJournalRequest({command:'setup'});
    if(result?.storage !== 'standard' || !result.configured){
      crmJournalWarning = 'Falha na ativação. Confira se o componente do Windows está atualizado e se a conta tem acesso à pasta padrão.';
      return;
    }
    crmJournalStorage = 'standard';
    crmJournalWarning = '';
    crmJournalExpiring = result.expiring || 0;
    toast('Diário ativo neste terminal.');
  } finally {
    crmJournalSetupInProgress = false;
    crmJournalRender();
  }
}

let crmJournalRecordsInProgress = 0;
async function crmJournalRecord(action, payload, id = crypto.randomUUID()){
  crmJournalRecordsInProgress++;
  try {
    return await crmJournalAppend(action, payload, id);
  } finally {
    crmJournalRecordsInProgress--;
  }
}

async function crmJournalAppend(action, payload, id){
  if(!crmJournalActions.has(action) || !state.currentUser || new URLSearchParams(location.search).has('public')) return null;
  await browserJournalLoad;
  if(!crmJournalEnabled && !browserJournalConfig) return null;
  const request = crmJournalEnabled ? crmJournalRequest : browserJournalRequest;
  try {
    // Conservar os campos operacionais e evitar guardar nome/telefone quando já há cliente identificado.
    const details = {operatorId:state.currentUser, house:payload.house || getSessionHouse()};
    const clientId = payload.customerId || payload.customer_id || payload.clientId;
    const keys = ['id','status','date','time','arrival','people','house','table','source','notes','priority','priorities','preference','createdAt','timeRegistered','calledAt','seatedAt','waitDurationMinutes','cloudRevision','amount','reason','operatorReception','_waitlistRefId','attendanceOrigin','arrivalTime','observations','exceptionReason','departure'];
    const record = Object.fromEntries(keys.filter(key => payload[key] !== undefined).map(key => [key,payload[key]]));
    if(clientId && isUUID(clientId)) record.customerId = clientId;
    if(!record.customerId || !state.clients.some(client => client.id === record.customerId && client.serverUpdatedAt)){
      if(payload.name) record.name = payload.name;
      if(payload.phone) record.phone = payload.phone;
    }
    const result = await request({command:'append',id,action,details:{...details,record}});
    if(!result || result.configured === false) throw new Error('Diário indisponível');
    crmJournalExpiring = result.expiring || 0;
    crmJournalRender();
    return id;
  } catch(error){
    crmJournalWarning = 'Uma operação ficou sem proteção do diário local. Verifique a configuração em Dados & Backup.';
    crmJournalRender();
    return null;
  }
}

async function crmJournalConfirm(id){
  if(!id) return;
  const request = crmJournalEnabled ? crmJournalRequest : browserJournalRequest;
  const result = await request({command:'confirm',id});
  if(result && result.configured !== false) crmJournalExpiring = result.expiring || 0;
  else crmJournalWarning = 'O Supabase recebeu uma operação, mas o diário local não conseguiu guardar a confirmação.';
  crmJournalRender();
}

async function crmJournalCheck(){
  if(typeof state === 'undefined' || !state.currentUser || new URLSearchParams(location.search).has('public')) return;
  await browserJournalLoad;
  const request = crmJournalEnabled ? crmJournalRequest : browserJournalRequest;
  const result = await request({command:'status'});
  if(crmJournalSetupInProgress) return;
  crmJournalStorage = result && result.configured !== false
    ? (crmJournalEnabled ? result.storage || 'legacy' : 'browser')
    : 'none';
  crmJournalExpiring = result?.expiring || 0;
  browserJournalRender();
  crmJournalRender();
}

setInterval(crmJournalCheck, 60000);
window.addEventListener('focus', crmJournalCheck);

window.postMessage({channel:'qu4tro-journal-discover'}, location.origin);
