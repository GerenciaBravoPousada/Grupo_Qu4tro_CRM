function maskClientPhone(value){
  let phone = digits(value);
  if((phone.length === 12 || phone.length === 13) && phone.startsWith('55')) phone = phone.slice(2);
  if(!phone || /^0+$/.test(phone)) return '—';
  if(phone.length !== 10 && phone.length !== 11) return '••••';
  return phone.slice(0,2) + '-' + phone[2] + '*'.repeat(phone.length-7) + '-' + phone.slice(-4);
}

function phonePrivacyOperator(){
  return state.users.find(user => user.active && user.id === state.currentUser);
}

function canExportFullClientPhones(){
  return phonePrivacyOperator()?.role === 'Master';
}

const phoneAuditWindows = new Map();
function notePhoneAudit(action, house, count = 1, operatorId = phonePrivacyOperator()?.id || null){
  void writePhoneAudit({action,house:normalizeHouseKey(house || getSessionHouse()),operatorId,count,
    at:new Date().toISOString()}).catch(() => console.warn('[CRM] Auditoria de telefone indisponível.'));
}

async function writePhoneAudit(event){
  const db = await openCrmVaultDB();
  if(!db) throw new Error('IndexedDB indisponível');
  await new Promise((resolve,reject)=>{
    const tx = db.transaction('vault_records','readwrite');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    const records = tx.objectStore('vault_records');
    records.put({key:'phone-audit:' + event.at + ':' + generateUUID(),phoneAudit:event});
    const end = 'phone-audit:' + new Date(Date.now()-30*86400000).toISOString();
    records.delete(IDBKeyRange.bound('phone-audit:',end));
  });
}

function notePhoneAuditRate(action, limit, house, operatorId){
  const key = action + ':' + (operatorId || phonePrivacyOperator()?.id || 'sem-sessao');
  const now = Date.now();
  const history = (phoneAuditWindows.get(key) || []).filter(at => now-at < 5*60000);
  history.push(now);
  phoneAuditWindows.set(key,history);
  if(history.length === limit) notePhoneAudit(action,house,limit,operatorId);
}

async function openPhoneAudit(){
  if(!canExportFullClientPhones()) return;
  el('modalTitle').textContent = 'Auditoria de telefones deste terminal';
  el('modalBody').textContent = 'Carregando…';
  el('modal').classList.add('show');
  try{
    const db = await openCrmVaultDB();
    if(!db) throw new Error();
    const rows = await new Promise((resolve,reject)=>{
      const req = db.transaction('vault_records').objectStore('vault_records')
        .getAll(IDBKeyRange.bound('phone-audit:', 'phone-audit:\uffff'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const names = Object.fromEntries(state.users.map(user => [user.id,user.name]));
    el('modalBody').innerHTML = rows.length ? '<ul>' + rows.slice(-100).reverse().map(({phoneAudit:e}) =>
      '<li>' + esc(new Date(e.at).toLocaleString('pt-BR')) + ' • ' + esc(names[e.operatorId] || 'Sem identificação') +
      ' • ' + esc(houseLabel(e.house)) + ' • ' + esc(e.action) + ' (' + e.count + ')</li>').join('') + '</ul>'
      : '<p>Nenhum evento de telefone registrado neste terminal.</p>';
  } catch {el('modalBody').textContent = 'Não foi possível ler a auditoria deste terminal.';}
}

function choosePhoneExport(label,count){
  notePhoneAudit('Exportação com telefones mascarados',getSessionHouse(),count);
  notePhoneAuditRate('Exportações repetidas em 5 minutos',3);
  if(count >= 200) notePhoneAudit('Exportação de volume alto',getSessionHouse(),count);
  return false;
}
