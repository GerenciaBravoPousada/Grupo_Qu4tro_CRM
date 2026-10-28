const assert = require('node:assert/strict');
const A = require('../reservation-attendance.js');
const r = (id, extra={}) => ({id, phone:'22999991111', date:'2026-10-27', house:'Leña', people:2, status:'Confirmada', ...extra});
const v = (id, extra={}) => ({id, phone:'5522999991111', date:'2026-10-27', house:'Leña', people:3, ...extra});
const build = (rs, vs) => A.build(rs, vs, '2026-10-28', x=>x, x=>x);
let rs = [r('a', {status:'Convertida'}), r('b', {phone:'0'}), r('c', {status:'Cancelada'}), r('d', {date:'2026-10-29'})];
let out = build(rs,[v('v')]);
assert.equal(out.get('a').status,'Não compareceu','legacy converted flag is not evidence');
assert.equal(out.get('a').candidates.length,1);
assert.equal(out.get('b').candidates.length,0,'empty phone cannot match');
assert.equal(out.get('c').status,'Cancelada');
assert.equal(out.get('d').status,'Aguardando');
rs[0].notes = A.write('Observação do cliente', {outcome:'attended', visitId:'v', by:'Recepção'});
rs[1].notes = A.write('', {outcome:'absent'});
out=build(rs,[v('v')]);
assert.equal(out.get('a').status,'Compareceu');
assert.equal(out.get('b').status,'Não compareceu');
const c=A.summary(rs,out);
assert.equal(c.attendanceRate,50); assert.equal(c.absenceRate,50); assert.equal(c.cancellationRate,25);
assert.equal(c.actualPeople,3); assert.equal(c.expectedPeople,8);
assert.equal(A.summary([],new Map()).attendanceRate,null);
assert.equal(A.clean(rs[0].notes),'Observação do cliente');
assert.deepEqual(A.read(JSON.parse(JSON.stringify(rs[0])).notes), {outcome:'attended',visitId:'v',by:'Recepção'});
assert.equal(build(rs,[v('v',{house:'Íconico'})]).get('a').status,'Não compareceu');
assert.equal(build(rs,[v('v',{date:'2026-10-26'})]).get('a').status,'Não compareceu');
assert.equal(build(rs,[]).get('a').status,'Não compareceu','deleted visit invalidates presence');
const duplicate=[rs[0],r('other',{notes:rs[0].notes})];
assert.equal(build(duplicate,[v('v')]).get('a').status,'Não compareceu','duplicate claims cannot inflate attendance');
assert.equal(build([r('future',{date:'2026-10-29',notes:rs[1].notes})],[]).get('future').status,'Aguardando');
assert.equal(build([r('same',{customerId:'customer',phone:'0'})],[v('v',{customer_id:'customer',phone:'0'})]).get('same').candidates.length,1);
assert.equal(A.read('[PRESENCA:invalid]'),null);
assert.equal(build([r('today',{date:'2026-10-28'})],[]).get('today').status,'Aguardando');
console.log('Reservation attendance: all assertions passed');

// Screenshot scenario: 87 = 43 attended + 29 absent + 2 cancelled + 13 awaiting.
const sample=[], visits=[];
for(let i=0;i<87;i++) {
  const row=r('sample-'+i);
  if(i<43){ const visit=v('visit-'+i);visits.push(visit);row.notes=A.write('',{visitId:visit.id}); }
  else if(i<72){} else if(i<74) row.status='Cancelada';else row.date='2026-10-29';
  sample.push(row);
}
const summary=A.summary(sample,build(sample,visits));
assert.equal(summary.absent,29);assert.equal(summary.pending,13);assert.equal(summary.cancelled,2);
assert.equal(summary.attended,43);assert.equal(summary.attendanceRate,43/72*100);
assert.equal(summary.absenceRate,29/72*100);
