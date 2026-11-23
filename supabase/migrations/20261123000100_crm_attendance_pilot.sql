-- Additive pilot. Existing customer, visit, reservation and waitlist rows are untouched.
create table grupo_qu4tro.crm_attendance_links (
  origin_kind text not null check (origin_kind in ('reservation','waitlist')),
  origin_id text not null,
  visit_id uuid not null references grupo_qu4tro.visits(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (origin_kind, origin_id),
  unique (origin_kind, visit_id)
);
alter table grupo_qu4tro.crm_attendance_links enable row level security;
revoke all on grupo_qu4tro.crm_attendance_links from public, anon, authenticated;
grant select, insert on grupo_qu4tro.crm_attendance_links to anon, authenticated;
create policy crm_attendance_read on grupo_qu4tro.crm_attendance_links for select to anon, authenticated using (true);
create policy crm_attendance_insert on grupo_qu4tro.crm_attendance_links for insert to anon, authenticated with check (true);

create function grupo_qu4tro.crm_attendance_phone(value text) returns text
language sql immutable set search_path = '' as $$
  select case when p ~ '^55[0-9]{10,11}$' then substr(p,3)
              when p ~ '^[0-9]{10,11}$' then p else '' end
  from (select regexp_replace(coalesce(value,''),'[^0-9]','','g') p) as digits;
$$;

create function public.crm_confirm_attendance(payload jsonb, origin_kind text, origin_id text, existing_visit_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  kind alias for $2;
  ref alias for $3;
  candidate grupo_qu4tro.visits;
  reservation grupo_qu4tro.reservations;
  queue public.crm_pre_checkins;
  linked uuid;
  queue_state jsonb;
  queue_revision timestamptz;
  source_customer uuid;
  source_phone text;
  source_house text;
  source_date date;
begin
  if kind = 'reservation' then
    select * into strict reservation from grupo_qu4tro.reservations where id = ref::uuid for update;
    source_customer := reservation.customer_id;
    source_phone := reservation.customer_phone;
    source_house := reservation.house;
    source_date := reservation.reservation_date;
  elsif kind = 'waitlist' then
    select * into strict queue from public.crm_pre_checkins where id = ref for update;
    source_customer := case when (queue.entry->>'clientId') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then (queue.entry->>'clientId')::uuid end;
    source_phone := queue.entry->>'phone';
    source_house := queue.entry->>'house';
    source_date := queue.business_date;
  else
    raise exception 'Origem inválida' using errcode = '22023';
  end if;

  select l.visit_id into linked from grupo_qu4tro.crm_attendance_links l where l.origin_kind=kind and l.origin_id=ref;
  if linked is not null then
    return jsonb_build_object('visit_id',linked,'already_confirmed',true,
      'queue',queue.entry,'queue_revision',queue.updated_at);
  end if;
  if (kind='reservation' and reservation.status in ('Cancelada','Convertida'))
     or (kind='waitlist' and queue.status not in ('Aguardando','Chamado')) then
    raise exception 'Atendimento já encerrado ou cancelado' using errcode = '23514';
  end if;

  if existing_visit_id is not null then
    select * into strict candidate from grupo_qu4tro.visits where id = existing_visit_id for update;
  else
    candidate := jsonb_populate_record(null::grupo_qu4tro.visits,payload);
  end if;
  if candidate.id is null or source_date is distinct from candidate.visit_date
     or lower(translate(trim(source_house),'ÍíÑñ','Iinn')) is distinct from lower(translate(trim(candidate.house),'ÍíÑñ','Iinn'))
     or not (
       coalesce(source_customer = candidate.customer_id,false)
       or ((source_customer is null or candidate.customer_id is null)
           and grupo_qu4tro.crm_attendance_phone(source_phone) <> ''
           and grupo_qu4tro.crm_attendance_phone(source_phone)=grupo_qu4tro.crm_attendance_phone(candidate.customer_phone))
     ) then
    raise exception 'Atendimento e check-in não correspondem' using errcode = '23514';
  end if;

  if existing_visit_id is null then
    if exists(select 1 from grupo_qu4tro.visits where id=candidate.id) then
      raise exception 'Identificador de visita existente. Confira e vincule a visita original.' using errcode = '23505';
    end if;
    perform public.crm_save_visit(payload);
  end if;
  if kind='reservation' then
    update grupo_qu4tro.reservations set status='Convertida', customer_id=coalesce(customer_id,candidate.customer_id),
      notes=concat_ws(E'\n',nullif(notes,''),'[PRESENCA:'||jsonb_build_object('outcome','attended','visitId',candidate.id)::text||']')
      where id=reservation.id;
  else
    update public.crm_pre_checkins set status='Atendido',
      entry=entry || jsonb_build_object('status','Atendido','visitId',candidate.id,'seatedAt',candidate.arrival_time,
        'table',candidate.table_number,'clientId',candidate.customer_id)
      where id=queue.id returning entry,updated_at into queue_state,queue_revision;
  end if;
  insert into grupo_qu4tro.crm_attendance_links values(kind,ref,candidate.id,now());
  return jsonb_build_object('visit_id',candidate.id,'already_confirmed',false,
    'queue',queue_state,'queue_revision',queue_revision);
end;
$$;
revoke all on function public.crm_confirm_attendance(jsonb,text,text,uuid) from public;
grant execute on function public.crm_confirm_attendance(jsonb,text,text,uuid) to anon,authenticated;
