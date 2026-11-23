const crmUpdateSessionKey = 'qu4tro_release_handoff';
const crmReleaseVersion = document.querySelector('meta[name="crm-release"]')?.content;
const crmReleasePattern = /^[a-f0-9]{40}$/;

function crmConsumeUpdateSession(){
  const url = new URL(location.href);
  if(url.pathname !== new URL('release.html', location.href).pathname ||
      !url.hash.startsWith('#crm-update=')) return null;
  const token = url.hash.slice('#crm-update='.length);
  url.hash = '';
  history.replaceState(history.state, '', url);
  try {
    const raw = sessionStorage.getItem(crmUpdateSessionKey);
    sessionStorage.removeItem(crmUpdateSessionKey);
    const resume = JSON.parse(raw);
    if(resume?.token === token && resume.version === crmReleaseVersion &&
        crmReleasePattern.test(crmReleaseVersion) && Date.now() < resume.expires){
      return resume;
    }
  }catch {}
  return null;
}

function startCrmReleaseUpdates(){
  if(window.qu4troDesktop || document.getElementById('publicRegistration')?.classList.contains('show') ||
      new URLSearchParams(location.search).has('public') ||
      !['/', '/index.html', '/release.html'].includes(location.pathname)) return;

  const dirty = new Set();
  let checking = false;
  let available = null;
  let postponed = false;
  let lastProbe = 0;
  let lastInteraction = 0;
  const notice = document.createElement('aside');
  notice.className = 'crm-update-notice';
  notice.style.zIndex = '1000000';
  notice.hidden = true;
  notice.innerHTML = '<span role="status">Atualização disponível</span> <button type="button" class="btn">Atualizar agora</button>';
  document.body.append(notice);
  const status = notice.querySelector('span');
  const button = notice.querySelector('button');

  for(const kind of ['input', 'change']){
    document.addEventListener(kind, event => {
      const form = event.target.form || event.target.closest?.('form');
      if(form) dirty.add(form);
    }, true);
  }
  document.addEventListener('reset', event => dirty.delete(event.target), true);
  for(const kind of ['pointerdown', 'keydown', 'submit']){
    document.addEventListener(kind, () => {lastInteraction = Date.now();}, true);
  }

  function blocked(){
    for(const form of dirty){
      if(!form.isConnected || (!form.getClientRects().length && form.closest('#modal, #loginScreenOverlay'))){
        dirty.delete(form);
      }
    }
    return dirty.size || el('modal')?.classList.contains('show') ||
      el('sessionOverlay')?.classList.contains('show') ||
      selectedCheckinClientId || selectedCheckinReservationId ||
      crmWrites.size || isOutboxProcessing || crmJournalCalls.size || crmJournalRecordsInProgress ||
      Date.now() - lastInteraction < 1500;
  }

  async function pendingWork(){
    if(blocked()) return true;
    const items = await getOutboxItems();
    return blocked() || items.length > 0;
  }

  async function check(force = false){
    if(checking || !navigator.onLine || document.hidden || window.crmReleaseNavigating) return;
    if(!force && Date.now() - lastProbe < 1500) return;
    checking = true;
    lastProbe = Date.now();
    button.disabled = true;
    try {
      const nonce = Date.now() + '-' + crypto.randomUUID();
      const response = await fetch('./version.json?probe=' + nonce, {cache:'no-store', signal:AbortSignal.timeout(8000)});
      if(!response.ok) return;
      const {version} = await response.json();
      if(!crmReleasePattern.test(version) || version === crmReleaseVersion){
        if(version === crmReleaseVersion){
          available = null;
          postponed = false;
          notice.hidden = true;
        }
        return;
      }
      if(available !== version) postponed = false;
      available = version;
      notice.hidden = false;
      if(await pendingWork()){
        postponed = true;
        status.textContent = 'Atualização disponível. Conclua ou cancele o trabalho em andamento antes de atualizar.';
        return;
      }
      if(postponed && !force){
        status.textContent = 'Atualização disponível';
        return;
      }

      const target = new URL('release.html', location.href);
      target.search = location.search;
      target.searchParams.set('release', version);
      target.searchParams.set('probe', nonce);
      const shell = await fetch(target, {cache:'no-store', signal:AbortSignal.timeout(12000)});
      if(!shell.ok) return;
      const html = await shell.text();
      if(!html.includes('<meta name="crm-release" content="' + version + '">')) return;
      if(await pendingWork()){
        postponed = true;
        return;
      }
      // The update handoff is consumed once. A manual reload has no handoff.
      if(state.currentUser){
        const token = crypto.randomUUID();
        try {
          sessionStorage.setItem(crmUpdateSessionKey, JSON.stringify({
            token, version, user:state.currentUser,
            view:document.querySelector('.view.active')?.id.replace('view-', ''),
            expires:Date.now() + 30000
          }));
        } catch{
          status.textContent = 'Atualização disponível. Saia da conta para atualizar.';
          return;
        }
        target.hash = 'crm-update=' + token;
      }
      window.crmReleaseNavigating = true;
      location.replace(target.href);
    }catch{
      // Keep the current release usable while the network or publication is unavailable.
    }finally{
      checking = false;
      button.disabled = false;
    }
  }

  button.onclick = () => {
    lastInteraction = 0;
    void check(true);
  };
  window.addEventListener('focus', () => void check());
  window.addEventListener('online', () => void check());
  document.addEventListener('visibilitychange', () => {if(!document.hidden) void check();});
  setInterval(check, 5 * 60 * 1000);
  void check();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'})
      .then(reg => reg.update()).catch(() => {});
  }
}
window.addEventListener('load', startCrmReleaseUpdates);
