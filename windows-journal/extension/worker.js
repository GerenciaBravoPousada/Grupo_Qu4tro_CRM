const crmOrigin = 'https://crm-grupo-qu4tro.iconiko.com.br';
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.origin !== crmOrigin || sender.frameId !== 0 || !message ||
      !['append', 'confirm', 'status'].includes(message.command) ||
      JSON.stringify(message).length > 60000) return;
  chrome.runtime.sendNativeMessage('br.com.grupoqu4tro.diario', message, result => {
    if (chrome.runtime.lastError) reply({ok: false});
    else reply(result);
  });
  return true;
});
