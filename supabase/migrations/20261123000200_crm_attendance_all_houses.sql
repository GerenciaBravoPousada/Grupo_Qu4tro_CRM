-- The existing queue stays in place. Legacy clients can still use the Iconiko rows.
alter policy crm_pre_checkins_read on public.crm_pre_checkins to anon, authenticated
  using (house in ('iconiko','lena','bravo-cafe','bravo-pousada'));
alter policy crm_pre_checkins_insert on public.crm_pre_checkins to anon, authenticated
  with check (house in ('iconiko','lena','bravo-cafe','bravo-pousada'));
alter policy crm_pre_checkins_update on public.crm_pre_checkins to anon, authenticated
  using (house in ('iconiko','lena','bravo-cafe','bravo-pousada'))
  with check (house in ('iconiko','lena','bravo-cafe','bravo-pousada'));

-- Keep the confirmed link when an older terminal replays a reservation edit.
create function grupo_qu4tro.crm_preserve_attended_reservation() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  linked uuid;
begin
  select visit_id into linked from grupo_qu4tro.crm_attendance_links
    where origin_kind='reservation' and origin_id=old.id::text;
  if linked is null then return new; end if;
  if new.house is distinct from old.house or new.reservation_date is distinct from old.reservation_date
      or new.customer_id is distinct from old.customer_id then
    raise exception 'Reserva com check-in vinculado: cliente, casa e data permanecem vinculados' using errcode='23514';
  end if;
  new.status := 'Convertida';
  if new.notes is distinct from old.notes then
    new.notes := concat_ws(E'\n',nullif(regexp_replace(coalesce(new.notes,''),'\[PRESENCA:[^]]*\]','','g'),''),
      '[PRESENCA:'||jsonb_build_object('outcome','attended','visitId',linked)::text||']');
  end if;
  return new;
end;
$$;
create trigger crm_preserve_attended_reservation
before update on grupo_qu4tro.reservations
for each row execute function grupo_qu4tro.crm_preserve_attended_reservation();
