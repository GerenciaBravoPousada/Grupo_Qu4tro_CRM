const browserJournalFile = 'grupo-qu4tro-diario-72h.jsonl';
const browserJournalEncoder = new TextEncoder();
const browserJournalHours = 60 * 60 * 1000;
const browserJournalSupported = typeof window.showDirectoryPicker === 'function' && !!navigator.locks && !!crypto.subtle;
let browserJournalConfig = null;
let browserJournalConnecting = false;
let browserJournalPermission = false;
let browserJournalNotice = '';
const browserJournalLoad = browserJournalSupported
  ? browserJournalSettings().catch(() => null).then(config => {browserJournalConfig = config || null;})
  : Promise.resolve();

async function browserJournalSettings(value){
  const db = await new Promise((resolve,reject) => {
    const request = indexedDB.open('Qu4troBrowserJournal',1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    return await new Promise((resolve,reject) => {
      const tx = db.transaction('settings',value ? 'readwrite' : 'readonly');
      const store = tx.objectStore('settings');
      const request = value ? store.put(value,'directory') : store.get('directory');
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {db.close();}
}

function browserJournalEncode(bytes){
  return btoa(Array.from(new Uint8Array(bytes), byte => String.fromCharCode(byte)).join(''));
}

function browserJournalDecode(value){
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function browserJournalKey(passphrase, salt){
  const input = await crypto.subtle.importKey('raw',browserJournalEncoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:browserJournalDecode(salt),iterations:600000,hash:'SHA-256'},
    input,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}

async function browserJournalSeal(key,value,identity){
  const nonce = browserJournalEncode(crypto.getRandomValues(new Uint8Array(12)));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv:browserJournalDecode(nonce),
    additionalData:browserJournalEncoder.encode(identity)},key,browserJournalEncoder.encode(JSON.stringify(value)));
  return {nonce,encrypted:browserJournalEncode(encrypted)};
}

async function browserJournalOpen(key,row,identity){
  const payload = await crypto.subtle.decrypt({name:'AES-GCM',iv:browserJournalDecode(row.nonce),
    additionalData:browserJournalEncoder.encode(identity)},key,browserJournalDecode(row.encrypted));
  return JSON.parse(new TextDecoder().decode(payload));
}

async function browserJournalRead(directory, allowCreate = false){
  let handle;
  try {handle = await directory.getFileHandle(browserJournalFile);}
  catch(error){
    if(!allowCreate || error.name !== 'NotFoundError') throw error;
    return {handle:null,header:null,rows:[]};
  }
  const content = await (await handle.getFile()).text();
  const lines = content.trim().split('\n');
  const header = JSON.parse(lines.shift());
  if(header.version !== 1 || !header.id || !header.salt || !header.check) throw new Error('Formato de diário inválido.');
  const rows = lines.map(line => JSON.parse(line));
  if(rows.some(row => !row.id || !Number.isFinite(row.createdAt) || !row.encrypted || !row.nonce))
    throw new Error('Registro inválido no diário.');
  return {handle,header,rows};
}

async function browserJournalWrite(handle, header, rows){
  const writer = await handle.createWritable();
  try {
    await writer.write([header,...rows].map(item => JSON.stringify(item)).join('\n') + '\n');
    await writer.close();
  } catch(error){
    try {await writer.abort();} catch {}
    throw error;
  }
}

const browserJournalLegacyParentFolder = 'Gestão de Apps Grupo Qu4tro';
const browserJournalStandardFolder = 'Backup_72hs_Gestao_Clientes';

function browserJournalSetupDialog(title,text){
  el('modalTitle').textContent = title;
  const body = el('modalBody');
  const message = document.createElement('p');
  message.textContent = text;
  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn';
  close.textContent = 'Fechar';
  close.onclick = closeModal;
  actions.append(close);
  body.replaceChildren(message,actions);
  el('modal').classList.add('show');
  return {body,message,actions};
}

async function browserJournalSetupDirectory(selected){
  try {
    await selected.getFileHandle(browserJournalFile);
    return selected;
  } catch(error){
    if(error.name !== 'NotFoundError') throw error;
  }
  if(selected.name === browserJournalStandardFolder) return selected;

  try {
    const parent = await selected.getDirectoryHandle(browserJournalLegacyParentFolder);
    const previous = await parent.getDirectoryHandle(browserJournalStandardFolder);
    await previous.getFileHandle(browserJournalFile);
    return previous;
  } catch(error){
    if(error.name !== 'NotFoundError') throw error;
  }
  return selected.getDirectoryHandle(browserJournalStandardFolder,{create:true});
}

async function browserJournalBind(directory,file,phrase){
  const header = file.header || {version:1,id:crypto.randomUUID(),
    salt:browserJournalEncode(crypto.getRandomValues(new Uint8Array(16)))};
  const key = await browserJournalKey(phrase,header.salt);
  if(file.header){
    if(await browserJournalOpen(key,header.check,header.id) !== 'Grupo Qu4tro') throw new Error('Chave incorreta');
  } else {
    header.check = await browserJournalSeal(key,'Grupo Qu4tro',header.id);
    await browserJournalWrite(await directory.getFileHandle(browserJournalFile,{create:true}),header,[]);
    const verified = await browserJournalRead(directory);
    if(await browserJournalOpen(key,verified.header.check,header.id) !== 'Grupo Qu4tro') throw new Error('Verificação da gravação falhou');
  }
  const config = {directory,key,id:header.id};
  await browserJournalSettings(config);
  browserJournalConfig = config;
  browserJournalPermission = true;
  browserJournalNotice = '';
  crmJournalWarning = '';
}

function browserJournalRecoveryKeyDialog(recovery){
  const {actions} = browserJournalSetupDialog('Diário ativo neste terminal',
    'O diário está gravando na pasta ' + browserJournalConfig.directory.name + '. Guarde a chave de recuperação em local privado. Ela só será necessária se os dados do Chrome forem apagados.');
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn primary';
  copy.textContent = 'Copiar chave de recuperação';
  copy.onclick = async () => {
    try {await navigator.clipboard.writeText(recovery);copy.textContent = 'Chave copiada';}
    catch {toast('Não foi possível copiar a chave.');}
  };
  actions.append(copy);
}

async function browserJournalCreateAlongside(directory){
  const folder = 'Novo diario ' + crypto.randomUUID();
  const recovery = Array.from(crypto.getRandomValues(new Uint8Array(24)),
    byte => byte.toString(16).padStart(2,'0')).join('');
  await navigator.locks.request('qu4tro-browser-journal',async () => {
    const target = await directory.getDirectoryHandle(folder,{create:true});
    const file = await browserJournalRead(target,true);
    if(file.header) throw new Error('Já existe um diário nessa pasta.');
    await browserJournalBind(target,file,recovery);
  });
  await crmJournalCheck();
  browserJournalRecoveryKeyDialog(recovery);
}

function browserJournalRecoverDialog(directory){
  const {message,actions} = browserJournalSetupDialog('Reconectar diário existente',
    'Já existe um diário na pasta selecionada. Digite a chave de recuperação original para reconectar.');
  const field = document.createElement('input');
  field.className = 'control';
  field.type = 'password';
  field.autocomplete = 'off';
  field.setAttribute('aria-label','Chave de recuperação do diário');
  actions.before(field);
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn primary';
  submit.textContent = 'Reconectar';
  submit.onclick = async () => {
    if(!field.value || submit.disabled || !state.currentUser) return;
    submit.disabled = true;
    try {
      await navigator.locks.request('qu4tro-browser-journal',async () => {
        await browserJournalBind(directory,await browserJournalRead(directory),field.value);
      });
      field.value = '';
      await crmJournalCheck();
      closeModal();
      toast('Diário ativo neste terminal.');
    } catch {
      message.textContent = 'Não foi possível reconectar. Confira a chave e a autorização da pasta. O arquivo foi preservado.';
    } finally {
      submit.disabled = false;
    }
  };
  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'btn';
  create.textContent = 'Criar novo backup';
  create.onclick = async () => {
    if(!state.currentUser || create.disabled || submit.disabled) return;
    if(!confirm('Iniciar um novo diário? O arquivo anterior será preservado para recuperação.')) return;
    create.disabled = submit.disabled = true;
    try {
      await browserJournalCreateAlongside(directory);
    } catch {
      message.textContent = 'Não foi possível criar o novo diário. Confira a permissão da pasta.';
    } finally {
      create.disabled = submit.disabled = false;
    }
  };
  actions.append(create);
  actions.append(submit);
  field.focus();
}

async function browserJournalQuickSetup(){
  if(!state.currentUser || browserJournalConnecting) return;
  if(!browserJournalSupported){
    browserJournalSetupDialog('Criar backup','Abra o CRM em um Chrome compatível com acesso a pastas.');
    return;
  }
  const existing = browserJournalConfig;
  if(existing){
    const {actions} = browserJournalSetupDialog('Reconectar ou escolher outra pasta',
      'Se já existe um diário neste terminal, reconecte a pasta. Você também pode escolher outra pasta autorizada.');
    const reconnect = document.createElement('button');
    reconnect.type = 'button';
    reconnect.className = 'btn';
    reconnect.textContent = 'Reconectar pasta';
    reconnect.onclick = async () => {
      await browserJournalReauthorize();
      if(browserJournalPermission){closeModal();toast('Diário ativo neste terminal.');}
      else toast('A pasta ainda está sem acesso. Confira a permissão ou escolha outra pasta.');
    };
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'btn primary';
    choose.textContent = 'Escolher pasta';
    choose.onclick = () => void browserJournalPickStandard();
    actions.append(reconnect,choose);
    return;
  }
  await browserJournalPickStandard();
}

async function browserJournalPickStandard(){
  if(browserJournalConnecting || !state.currentUser) return;
  browserJournalConnecting = true;
  let recovery = null;
  let bound = false;
  try {
    const selected = await window.showDirectoryPicker({id:'qu4tro-backup-documentos',startIn:'documents',mode:'readwrite'});
    const directory = await browserJournalSetupDirectory(selected);
    await navigator.locks.request('qu4tro-browser-journal',async () => {
      const file = await browserJournalRead(directory,true);
      if(file.header){
        if(browserJournalConfig?.id === file.header.id &&
          await browserJournalOpen(browserJournalConfig.key,file.header.check,file.header.id) === 'Grupo Qu4tro'){
          const config = {...browserJournalConfig,directory};
          await browserJournalSettings(config);
          browserJournalConfig = config;
          browserJournalNotice = '';
          crmJournalWarning = '';
          bound = true;
        } else {
          browserJournalRecoverDialog(directory);
        }
        return;
      }
      recovery = Array.from(crypto.getRandomValues(new Uint8Array(24)),byte => byte.toString(16).padStart(2,'0')).join('');
      await browserJournalBind(directory,file,recovery);
      bound = true;
    });
    if(bound) await crmJournalCheck();
    if(bound && !recovery){
      closeModal();
      toast('Diário ativo neste terminal.');
    }
    if(recovery) browserJournalRecoveryKeyDialog(recovery);
  } catch(error){
    if(error.name !== 'AbortError'){
      browserJournalNotice = 'Não foi possível ativar o diário nesta pasta. Confira a permissão de gravação.';
      crmJournalWarning = browserJournalNotice;
    }
  } finally {
    browserJournalConnecting = false;
    browserJournalRender();
    crmJournalRender();
  }
}

function browserJournalTogglePhrase(button){
  const input = document.getElementById('browserJournalPhrase');
  if(!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.textContent = show ? 'Ocultar frase' : 'Mostrar frase';
}

async function browserJournalConnect(event){
  event.preventDefault();
  if(browserJournalConnecting || !browserJournalSupported || !state.currentUser) return;
  const form = event.currentTarget;
  const input = form.querySelector('input');
  const passphrase = input.value;
  if(passphrase.length < 14){
    browserJournalNotice = 'Use uma frase de recuperação com pelo menos 14 caracteres.';
    browserJournalRender();
    return;
  }
  browserJournalConnecting = true;
  form.querySelector('button[type=submit]').disabled = true;
  let directory;
  try {
    directory = await window.showDirectoryPicker({id:'grupo-qu4tro-diario',mode:'readwrite'});
    await navigator.locks.request('qu4tro-browser-journal',async () => {
      const file = await browserJournalRead(directory,true);
      const header = file.header || {version:1,id:crypto.randomUUID(),salt:browserJournalEncode(crypto.getRandomValues(new Uint8Array(16)))};
      const key = await browserJournalKey(passphrase,header.salt);
      if(file.header){
        if(await browserJournalOpen(key,header.check,header.id) !== 'Grupo Qu4tro') throw new Error('Frase incorreta');
      } else {
        header.check = await browserJournalSeal(key,'Grupo Qu4tro',header.id);
        await browserJournalWrite(await directory.getFileHandle(browserJournalFile,{create:true}),header,[]);
      }
      const config = {directory,key,id:header.id};
      await browserJournalSettings(config);
      browserJournalConfig = config;
    });
    input.value = '';
    if(input.type === 'text') browserJournalTogglePhrase(form.querySelector('[aria-controls=browserJournalPhrase]'));
    browserJournalPermission = true;
    browserJournalNotice = 'Pasta vinculada. Guarde a frase de recuperação em local seguro.';
    await crmJournalCheck();
  } catch(error){
    if(error.name !== 'AbortError') browserJournalNotice = 'Não foi possível ativar o diário. Confira a pasta, a permissão de gravação e a frase de recuperação.';
  } finally {
    browserJournalConnecting = false;
    form.querySelector('button[type=submit]').disabled = false;
    browserJournalRender();
  }
}

async function browserJournalReauthorize(){
  if(!browserJournalConfig || !state.currentUser) return;
  try {
    browserJournalPermission = await browserJournalConfig.directory.requestPermission({mode:'readwrite'}) === 'granted';
    if(browserJournalPermission) await crmJournalCheck();
  } catch {browserJournalPermission = false;}
  browserJournalRender();
}

function browserJournalRender(){
  const status = document.getElementById('browserJournalStatus');
  if(!status) return;
  status.textContent = browserJournalNotice || (!browserJournalSupported
    ? 'Abra o CRM em um Chrome compatível para configurar.'
    : browserJournalPermission ? 'Diário ativo neste terminal.' : 'Diário inativo neste terminal.');
  const button = document.getElementById('browserJournalGrant');
  if(button) button.hidden = !browserJournalConfig || browserJournalPermission;
}

async function browserJournalRequest(message){
  await browserJournalLoad;
  const config = browserJournalConfig;
  if(!config) return null;
  try {
    if(await config.directory.queryPermission({mode:'readwrite'}) !== 'granted') throw new Error('Permissão necessária');
    const result = await navigator.locks.request('qu4tro-browser-journal',async () => {
      const file = await browserJournalRead(config.directory);
      if(file.header.id !== config.id) throw new Error('Pasta alterada');
      await browserJournalOpen(config.key,file.header.check,file.header.id);
      const now = Date.now();
      const rows = file.rows.filter(row => row.createdAt > now - 72 * browserJournalHours);
      let changed = rows.length !== file.rows.length;
      const row = rows.find(item => item.id === message.id);
      if(message.command === 'append'){
        const payload = {action:message.action,details:message.details};
        if(!row){
          const createdAt = now;
          rows.push({id:message.id,createdAt,confirmedAt:null,
            ...await browserJournalSeal(config.key,payload,message.id + ':' + createdAt)});
          changed = true;
        } else if(JSON.stringify(await browserJournalOpen(config.key,row,row.id + ':' + row.createdAt)) !== JSON.stringify(payload)){
          throw new Error('Identificador duplicado com dados diferentes');
        }
      } else if(message.command === 'confirm' && row && !row.confirmedAt){
        row.confirmedAt = now;
        changed = true;
      }
      if(changed) await browserJournalWrite(file.handle,file.header,rows);
      return {ok:true,expiring:rows.filter(item => !item.confirmedAt && item.createdAt <= now - 60 * browserJournalHours).length};
    });
    browserJournalPermission = true;
    return result;
  } catch {
    browserJournalPermission = false;
    browserJournalNotice = '';
    return null;
  } finally {browserJournalRender();}
}
