(function () {
  const calls = new Map();
  const bridge = window.chrome.webview;
  Object.defineProperty(window, 'qu4troDesktop', {value:true});
  try {
    localStorage.removeItem('qu4tro_auth_user');
    sessionStorage.removeItem('qu4tro_auth_user');
  } catch {}
  window.addEventListener('message', event => {
    if(event.source !== window || event.origin !== location.origin) return;
    if(event.data?.channel === 'qu4tro-journal-discover'){
      window.postMessage({channel:'qu4tro-journal-ready'}, location.origin);
    } else if(event.data?.channel === 'qu4tro-journal-request'){
      const {id,message}=event.data;
      if(typeof id !== 'string' || !message) return;
      calls.set(id,Date.now());
      for(const [key,at] of calls) if(Date.now()-at>35000) calls.delete(key);
      bridge.postMessage({id,message});
    }
  });
  bridge.addEventListener('message', event => {
    const {id,response}=event.data || {};
    if(calls.delete(id)) window.postMessage({channel:'qu4tro-journal-response',id,response},location.origin);
  });
})();
