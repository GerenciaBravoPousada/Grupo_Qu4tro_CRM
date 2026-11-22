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
