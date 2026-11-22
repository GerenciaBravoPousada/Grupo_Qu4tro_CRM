window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'qu4tro-journal-request') return;
  const {id, message} = event.data;
  if (typeof id !== 'string' || id.length !== 36) return;
  chrome.runtime.sendMessage(message, response => {
    const failed = chrome.runtime.lastError;
    window.postMessage({channel: 'qu4tro-journal-response', id, response: failed ? {ok: false} : response}, location.origin);
  });
});
