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

function canRevealClientPhone(house){
  const user = phonePrivacyOperator();
  if(!user) return false;
  return user.role === 'Master' || (user.role === 'Gerente' && !!house &&
    getUserHouses(user).includes(normalizeHouseKey(house)));
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

function revealCheckinClientPhone(button){
  const client = state.clients.find(item => item.id === selectedCheckinClientId) ||
    state.reservations.find(item => item.id === selectedCheckinReservationId);
  const house = el('ciHouse')?.value;
  if(!client || !canRevealClientPhone(house)) return;
  const target = el('ciPhoneRevealed');
  if(!target) return;
  if(target.textContent){
    target.textContent = '';
    button.textContent = 'Mostrar telefone completo';
    return;
  }
  target.textContent = fmtPhone(client.phone);
  button.textContent = 'Ocultar telefone';
  notePhoneAudit('Telefone revelado',house);
}

function checkinIdentityAmbiguous(client){
  return state.clients.some(other => other.id !== client.id &&
    foldText(other.name) === foldText(client.name) &&
    maskClientPhone(other.phone) === maskClientPhone(client.phone));
}

function checkinIdentityFields(client){
  const show = canRevealClientPhone(el('ciHouse')?.value)
    ? '<button type="button" class="btn" onclick="revealCheckinClientPhone(this)">Mostrar telefone completo</button> <span id="ciPhoneRevealed"></span>'
    : '';
  const additional = checkinIdentityAmbiguous(client)
    ? '<label for="ciIdentityPhone">Há cadastros com o mesmo nome e telefone mascarado. Digite o telefone completo informado pelo cliente.</label><input id="ciIdentityPhone" type="password" inputmode="tel" autocomplete="off" class="control">'
    : '';
  return '<div class="field"><label><input type="checkbox" id="ciIdentityConfirmed"> Conferi o nome e o telefone mascarado com o cliente.</label>' +
    additional + show + '</div>';
}

function checkinIdentityConfirmed(client){
  if(!el('ciIdentityConfirmed')?.checked) return false;
  if(!checkinIdentityAmbiguous(client)) return true;
  const given = normalizePhone(el('ciIdentityPhone')?.value || '');
  return !!given && given === normalizePhone(client.phone) &&
    !state.clients.some(other => other.id !== client.id && foldText(other.name) === foldText(client.name) && normalizePhone(other.phone) === given);
}

function choosePhoneExport(label,count){
  const full = canExportFullClientPhones() &&
    confirm('Exportar telefones completos em ' + label + '? Escolha Cancelar para baixar com telefones mascarados.');
  notePhoneAudit(full ? 'Exportação com telefones completos' : 'Exportação com telefones mascarados',getSessionHouse(),count);
  notePhoneAuditRate('Exportações repetidas em 5 minutos',3);
  if(count >= 200) notePhoneAudit('Exportação de volume alto',getSessionHouse(),count);
  return full;
}

function confirmWaitlistIdentity(entry){
  if(!confirm('Confira o nome e o telefone do cliente antes de concluir:\n' + entry.name + ' • ' + maskClientPhone(entry.phone))) return false;
  const lookalikes = state.waitlist.filter(other => other.id !== entry.id &&
    ['Aguardando','Chamado'].includes(other.status) && normalizeHouseKey(other.house) === normalizeHouseKey(entry.house) &&
    foldText(other.name) === foldText(entry.name) && maskClientPhone(other.phone) === maskClientPhone(entry.phone));
  if(!lookalikes.length) return true;
  const input = normalizePhone(prompt('Há grupos com o mesmo nome e telefone mascarado. Digite o telefone completo informado pelo cliente.') || '');
  if(!input || input !== normalizePhone(entry.phone) || lookalikes.some(other=>normalizePhone(other.phone) === input)){
    toast('Não foi possível diferenciar os grupos. Confira os dados antes de confirmar.');
    return false;
  }
  return true;
}
