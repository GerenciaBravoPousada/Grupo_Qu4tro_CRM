/* Presence is backed by a saved visit, never by the old "Convertida" flag.
 * Metadata uses the existing synchronized notes field so old clients/RPCs remain compatible. */
const ReservationAttendance = (() => {
  const marker = /\[PRESENCA:([^\]]*)\]/g;
  function read(notes) {
    const matches = [...String(notes || '').matchAll(marker)];
    try { return JSON.parse(decodeURIComponent(matches.at(-1)?.[1] || '')); } catch (_) { return null; }
  }
  function clean(notes) { return String(notes || '').replace(marker, '').trim(); }
  function write(notes, value) {
    return [clean(notes), value ? `[PRESENCA:${encodeURIComponent(JSON.stringify(value))}]` : ''].filter(Boolean).join('\n');
  }
  function phone(value) {
    let p = String(value || '').replace(/\D/g, '');
    if (p.startsWith('55') && p.length >= 12) p = p.slice(2);
    return p.length >= 10 ? p : '';
  }
  function samePerson(r, v) {
    const customer = r.customerId || r.customer_id;
    return !!((customer && customer === (v.customer_id || v.clientId || v.customerId)) ||
      (phone(r.phone) && phone(r.phone) === phone(v.phone)));
  }
  function build(reservations, visits, today, houseKey, dateKey) {
    const visitById = new Map(visits.map(v => [v.id, v]));
    const claimed = new Set();
    const explicit = new Map();
    // Reject duplicate claims instead of counting the same check-in twice.
    const claims = new Map();
    for (const r of reservations) {
      const m = read(r.notes);
      if (m?.visitId) claims.set(m.visitId, (claims.get(m.visitId) || 0) + 1);
    }
    for (const r of reservations) {
      const m = read(r.notes), v = visitById.get(m?.visitId);
      if (v && claims.get(v.id) === 1 && dateKey(v.date) === dateKey(r.date) && houseKey(v.house) === houseKey(r.house)) {
        explicit.set(r.id, v); claimed.add(v.id);
      }
    }
    return new Map(reservations.map(r => {
      const meta = read(r.notes), visit = explicit.get(r.id);
      let status;
      if (visit) status = 'Compareceu';
      else if (r.status === 'Cancelada') status = 'Cancelada';
      else status = dateKey(r.date) < today ? 'Não compareceu' : 'Futuras';
      const candidates = visit || status === 'Cancelada' ? [] : visits.filter(v => !claimed.has(v.id) &&
        dateKey(v.date) === dateKey(r.date) && houseKey(v.house) === houseKey(r.house) && samePerson(r, v));
      return [r.id, {status, visit, candidates, meta}];
    }));
  }
  function summary(rows, outcomes) {
    const counts = {total: rows.length, attended: 0, absent: 0, cancelled: 0, pending: 0, expectedPeople: 0, actualPeople: 0, absentPeople: 0, cancelledPeople: 0, futurePeople: 0};
    const keys = {'Compareceu':'attended', 'Não compareceu':'absent', 'Cancelada':'cancelled', 'Futuras':'pending'};
    for (const r of rows) {
      const o = outcomes.get(r.id); counts[keys[o.status]]++;
      const expected = Math.max(0, Number(r.people) || 0);
      const actual = o.visit ? Math.max(0, Number(o.visit.people) || 0) : 0;
      counts.expectedPeople += expected;
      if (o.visit) {
        counts.actualPeople += actual;
        counts.absentPeople += Math.max(0, expected - actual);
      } else if (o.status === 'Não compareceu') counts.absentPeople += expected;
      else if (o.status === 'Cancelada') counts.cancelledPeople += expected;
      else counts.futurePeople += expected;
    }
    const settled = counts.attended + counts.absent;
    counts.attendanceRate = settled ? counts.attended / settled * 100 : null;
    counts.absenceRate = settled ? counts.absent / settled * 100 : null;
    counts.cancellationRate = counts.total ? counts.cancelled / counts.total * 100 : null;
    const settledPeople = counts.actualPeople + counts.absentPeople;
    counts.peopleAttendanceRate = settledPeople ? counts.actualPeople / settledPeople * 100 : null;
    counts.peopleAbsenceRate = settledPeople ? counts.absentPeople / settledPeople * 100 : null;
    counts.peopleCancellationRate = counts.expectedPeople ? counts.cancelledPeople / counts.expectedPeople * 100 : null;
    counts.peopleFutureRate = counts.expectedPeople ? counts.futurePeople / counts.expectedPeople * 100 : null;
    return counts;
  }
  return {read, clean, write, samePerson, build, summary};
})();
if (typeof module !== 'undefined') module.exports = ReservationAttendance;

let selectedCheckinReservationId = null;
function reservationOutcomes() {
  return ReservationAttendance.build(state.reservations, state.visits, getLocalDateStr(0), normalizeHouseKey, normalizeDateIso);
}
function findCheckinReservation(pending) {
  if (pending.reservationId) return pending.reservationId;
  const outcomes = reservationOutcomes();
  const matches = state.reservations.filter(r => r.status !== 'Cancelada' &&
    normalizeDateIso(r.date) === getLocalDateStr(0) && normalizeHouseKey(r.house) === normalizeHouseKey(pending.house) &&
    ReservationAttendance.samePerson(r, {phone:pending.phone, customer_id:pending.forceClientId || pending.selectedId}) &&
    !outcomes.get(r.id).visit);
  // Ambiguous reservations remain available for explicit review; never guess.
  return matches.length === 1 ? matches[0].id : null;
}
function renderReservationAttendance(rows, outcomes) {
  const c = ReservationAttendance.summary(rows, outcomes);
  const pct = n => n === null ? '—' : n.toLocaleString('pt-BR', {maximumFractionDigits:1}) + '%';
  const items = [
    ['Reservas', c.total],
    ['Compareceram', c.attended, c.attendanceRate],
    ['Não compareceram', c.absent, c.absenceRate],
    ['Canceladas', c.cancelled, c.cancellationRate],
    ['Futuras', c.pending, c.total ? c.pending / c.total * 100 : null]
  ];
  const peopleItems = [
    ['Pessoas', c.expectedPeople],
    ['Compareceram', c.actualPeople, c.peopleAttendanceRate],
    ['Não compareceram', c.absentPeople, c.peopleAbsenceRate],
    ['Canceladas', c.cancelledPeople, c.peopleCancellationRate],
    ['Futuras', c.futurePeople, c.peopleFutureRate]
  ];
  const renderRow = (cards, label) => `<div class="reservation-kpis" aria-label="${label}">${cards.map(([label,value,rate]) => `<div class="kpi-chip"><span>${label}</span><strong style="white-space:nowrap">${value}${rate === undefined ? '' : ` <small style="font-size:13px;font-weight:600;color:var(--muted)">= ${pct(rate)}</small>`}</strong></div>`).join('')}</div>`;
  el('reservationAttendanceSummary').innerHTML = renderRow(items, 'Indicadores por reservas') + renderRow(peopleItems, 'Indicadores por pessoas');
}
function reservationAttendanceCell(outcome) {
  const v = outcome.visit;
  return `<span class="badge ${v ? 'good' : outcome.status === 'Não compareceu' ? 'warn' : 'blue'}">${esc(outcome.status)}</span>` +
    (v ? `<small style="display:block;margin-top:5px">${esc(v.arrival || 'Horário não informado')} • ${esc(String(v.people || 0))} pessoas<br>${esc(v.operatorReception || 'Atendente não informado')}</small>` :
    outcome.candidates.length ? `<small style="display:block;margin-top:5px;color:#a86414">${outcome.candidates.length} check-in(s) possível(is): conferir</small>` : '') +
    (outcome.meta?.by ? `<small style="display:block;margin-top:5px;color:var(--muted)">Conferido por ${esc(outcome.meta.by)}</small>` : '');
}
function openReservationAttendance(id) {
  const r = state.reservations.find(x => x.id === id); if (!r) return;
  const o = reservationOutcomes().get(id);
  el('modalTitle').textContent = 'Conferir comparecimento';
  el('modalBody').innerHTML = `<p><b>${esc(r.name)}</b> • ${fmtDate(r.date)} • ${esc(houseLabel(normalizeHouseKey(r.house)))}</p>
    <p>${reservationAttendanceCell(o)}</p>
    ${o.candidates.length ? `<p>Confira se um destes registros corresponde a esta reserva:</p>${o.candidates.map(v => `<button type="button" class="btn" style="margin:4px" onclick="confirmReservationVisit('${esc(id)}','${esc(v.id)}')">Vincular ${esc(v.name)} • ${esc(v.arrival || 'sem horário')} • ${esc(String(v.people))} pessoas • ${esc(v.operatorReception || 'sem atendente')}</button>`).join('')}` : ''}
    ${o.meta ? `<button class="btn" onclick="clearReservationAttendance('${esc(id)}')">Desfazer conferência</button>` : ''}
    <div class="form-actions"><button class="btn" onclick="closeModal()">Fechar</button></div>`;
  el('modal').classList.add('show');
}
function saveReservationAttendance(r, value) {
  const user = getCurrentUser();
  r.notes = ReservationAttendance.write(r.notes, value ? {...value, by:user?.name || 'Recepção', at:new Date().toISOString()} : null);
  save(); dbSyncReservation(r); closeModal(); renderReservations();
}
function confirmReservationVisit(id, visitId) {
  const r = state.reservations.find(x => x.id === id), o = reservationOutcomes().get(id);
  if (!r || !o?.candidates.some(v => v.id === visitId)) { toast('Este check-in não está mais disponível para vínculo.'); return; }
  if (!confirm('Confirma que este check-in corresponde à reserva selecionada?')) return;
  r.status = 'Convertida';
  saveReservationAttendance(r, {outcome:'attended', visitId});
}
function clearReservationAttendance(id) {
  const r = state.reservations.find(x => x.id === id); if (!r) return;
  if (!confirm('Desfazer a conferência desta reserva? O check-in será preservado.')) return;
  saveReservationAttendance(r, null);
}

function reservationDisplayStatus(r, outcome) {
  return outcome.status === 'Não compareceu' ? 'Não compareceu' : r.status;
}
