const crmEditForms = new Set(['editClientForm','editPrioritiesForm','editCheckinForm','editUserForm',
  'myProfileForm','settingsForm','fpRenameSectionForm','fpTableForm']);
const crmConfirmForms = new Set([...crmEditForms,'checkinForm','reservationForm','newClientForm','addToWaitlistForm',
  'waitlistCheckinForm','cancelCheckinForm','newUserForm','changePassForm','wppTmplForm','newVoucherForm',
  'fpAddSectionForm','publicForm','browserJournalForm']);
const crmFormBaselines = new WeakMap();

function crmFormSnapshot(form){
  return JSON.stringify([...form.elements].filter(field =>
    ['INPUT','SELECT','TEXTAREA'].includes(field.tagName) &&
    !['button','submit','reset','hidden'].includes(field.type)
  ).map(field=>[field.id || field.name, ['checkbox','radio'].includes(field.type)
    ? field.checked : field.type === 'password' ? field.value : field.value.trim()]));
}

function crmFormReady(form){
  const field = id => form.querySelector('#'+id);
  const value = id => field(id)?.value.trim() || '';
  const name = id => value(id) && validateClientName(value(id)).ok;
  const phone = id => field(id)?.readOnly || (value(id) && validatePhone(value(id)).ok);
  if([...form.elements].some(control => control.willValidate && (!control.validity.valid ||
    (control.required && typeof control.value === 'string' && !control.value.trim())))) return false;
  switch(form.id){
    case 'editClientForm': return !!name('ecName') && phone('ecPhone');
    case 'newClientForm': return !!name('ncName') && phone('ncPhone');
    case 'checkinForm': return !!value('ciName') && (field('ciPhone')?.readOnly || !!name('ciName')) && phone('ciPhone');
    case 'addToWaitlistForm': return !!value('wlName') && (field('wlPhone')?.readOnly || !!name('wlName')) && phone('wlPhone');
    case 'reservationForm': return !!value('rName') && phone('rPhone');
    case 'newUserForm': return phone('nuPhone') && !!form.querySelector('input[name=nuHouses]:checked');
    case 'editUserForm': return phone('euPhone') && !!form.querySelector('input[name=euHouses]:checked');
    case 'myProfileForm': return phone('mpPhone');
    case 'changePassForm': {
      const pass=field('cpNewPass').value;
      return pass===field('cpConfirmPass').value && pass.length>=8 && pass===pass.trim() &&
        /\p{Lu}/u.test(pass) && /\p{Ll}/u.test(pass) && /[0-9]/.test(pass) && /[\p{P}\p{S}]/u.test(pass);
    }
    case 'browserJournalForm': return field('browserJournalPhrase').value.length>=14;
    case 'cancelCheckinForm': return value('cancelCiReason').length>=3;
    default: return true;
  }
}

function crmSetActionReadiness(button,ready){
  button.classList.add('crm-confirm-action');
  if(!ready){
    if(!button.disabled){
      button.dataset.crmReadinessDisabled='yes';
      button.disabled=true;
    }
  } else if(button.dataset.crmReadinessDisabled){
    delete button.dataset.crmReadinessDisabled;
    button.disabled=false;
  }
}

function crmFormRefresh(form){
  if(!form || !crmConfirmForms.has(form.id)) return;
  const editing=crmEditForms.has(form.id) || form.dataset.requiresChange==='true';
  const current=editing ? crmFormSnapshot(form) : null;
  if(editing && !crmFormBaselines.has(form)) crmFormBaselines.set(form,current);
  const ready=(!editing || crmFormBaselines.get(form)!==current) && crmFormReady(form);
  for(const button of [...form.elements].filter(control=>control.type==='submit')){
    if(button.form===form) crmSetActionReadiness(button,ready);
  }
  return ready;
}

function crmResetFormBaseline(form){
  if(!form) return;
  crmFormBaselines.set(form,crmFormSnapshot(form));
  crmFormRefresh(form);
}

function crmRefreshActionForms(){
  for(const form of document.forms) crmFormRefresh(form);
  for(const button of document.querySelectorAll('[data-crm-confirm-field]')){
    const input=document.getElementById(button.dataset.crmConfirmField);
    crmSetActionReadiness(button,!!input?.value.trim() && input.validity.valid &&
      (!button.hasAttribute('data-crm-requires-change') || input.value.trim()!==input.defaultValue.trim()));
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  crmRefreshActionForms();
  const modal=document.getElementById('modalBody');
  if(modal) new MutationObserver(crmRefreshActionForms).observe(modal,{childList:true,subtree:true});
  for(const event of ['input','change','reset','click','focusin']){
    document.addEventListener(event,()=>queueMicrotask(crmRefreshActionForms));
  }
  document.addEventListener('submit',event=>{
    if(crmFormRefresh(event.target)===false){
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },true);
});
