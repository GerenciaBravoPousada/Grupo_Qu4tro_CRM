begin;
create function bravo_internal.crm_bump_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_TABLE_SCHEMA <> 'grupo_qu4tro' then raise exception 'Unexpected CRM schema'; end if;
 update public.bravo_data_versions set version=gen_random_uuid(),changed_at=clock_timestamp() where table_name=TG_TABLE_NAME;
 return null;
end $$;
revoke all on function bravo_internal.crm_bump_version() from public,anon,authenticated;
-- Extend the existing read-only cache manifest to the CRM tables.
do $$ declare n text; begin
 foreach n in array array['customers','visits','reservations','app_users','app_settings'] loop
  insert into public.bravo_data_versions(table_name) values(n) on conflict do nothing;
  if not exists(select 1 from pg_trigger where tgrelid=('grupo_qu4tro.'||n)::regclass and tgname='bravo_data_version_changed') then
   execute format('create trigger bravo_data_version_changed after insert or update or delete or truncate on grupo_qu4tro.%I for each statement execute function bravo_internal.crm_bump_version()',n);
  end if;
 end loop;
end $$;
-- Contains only identifiers/routing metadata, never customer names or phones.
create table public.crm_reservation_events (
 id bigint generated always as identity primary key,
 house text not null,
 reservation_date date not null,
 reservation_id uuid not null,
 changed_at timestamptz not null default clock_timestamp()
);
create index crm_reservation_events_house_day_id on public.crm_reservation_events(house,reservation_date,id);
alter table public.crm_reservation_events enable row level security;
revoke all on public.crm_reservation_events from public,anon,authenticated;
grant select on public.crm_reservation_events to anon,authenticated;
grant all on public.crm_reservation_events to service_role;
create policy "Read reservation change identifiers" on public.crm_reservation_events for select to anon,authenticated using(true);
create function bravo_internal.crm_notify_reservation() returns trigger
language plpgsql security definer set search_path='' as $$
declare rec record; event_id bigint;
begin
 -- OLD route is essential for deletes and moves between houses or dates.
 for rec in select distinct house,reservation_date,id from (
  select OLD.house,OLD.reservation_date,OLD.id where TG_OP <> 'INSERT'
  union all select NEW.house,NEW.reservation_date,NEW.id where TG_OP <> 'DELETE'
 ) routes loop
  insert into public.crm_reservation_events(house,reservation_date,reservation_id) values(rec.house,rec.reservation_date,rec.id) returning id into event_id;
  if rec.reservation_date = (clock_timestamp() at time zone 'America/Sao_Paulo')::date then
   perform realtime.send(jsonb_build_object('reservation_id',rec.id,'revision',event_id),'changed','crm-reservations:'||rec.house||':'||rec.reservation_date::text,false);
  end if;
 end loop;
 return null;
end $$;
revoke all on function bravo_internal.crm_notify_reservation() from public,anon,authenticated;
create trigger crm_reservation_notice after insert or update or delete on grupo_qu4tro.reservations for each row execute function bravo_internal.crm_notify_reservation();
-- Optimistic concurrency uses the existing table RLS: no elevated data privileges.
create function public.crm_save_customer(payload jsonb,expected_updated_at timestamptz default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare customer public.customers; saved public.customers;
begin
 customer := jsonb_populate_record(null::public.customers,payload);
 if expected_updated_at is not null then
  update public.customers set name=customer.name,phone=customer.phone,email=customer.email,
   first_house=customer.first_house,first_visit=customer.first_visit,last_visit=customer.last_visit,
   total_visits=customer.total_visits,visits_lena=customer.visits_lena,visits_iconiko=customer.visits_iconiko,
   visits_cafe=customer.visits_cafe,source=customer.source,registration_channel=customer.registration_channel,
   preferences=customer.preferences,notes=customer.notes,updated_at=clock_timestamp()
  where id=customer.id and updated_at=expected_updated_at returning * into saved;
  if not found then raise exception 'Cadastro alterado por outra pessoa. Atualize os dados antes de tentar novamente.' using errcode='40001'; end if;
 else
  insert into public.customers(id,name,phone,email,first_house,first_visit,last_visit,total_visits,visits_lena,visits_iconiko,visits_cafe,source,registration_channel,preferences,notes)
  values(customer.id,customer.name,customer.phone,customer.email,customer.first_house,customer.first_visit,customer.last_visit,customer.total_visits,customer.visits_lena,customer.visits_iconiko,customer.visits_cafe,customer.source,customer.registration_channel,customer.preferences,customer.notes)
  returning * into saved;
 end if;
 return jsonb_build_object('id',saved.id,'updated_at',saved.updated_at);
end $$;
revoke all on function public.crm_save_customer(jsonb,timestamptz) from public;
grant execute on function public.crm_save_customer(jsonb,timestamptz) to anon,authenticated,service_role;

create function public.crm_save_visit(payload jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare r grupo_qu4tro.visits;
begin
 r:=jsonb_populate_record(null::grupo_qu4tro.visits,payload);
 insert into grupo_qu4tro.visits(id,customer_id,customer_name,customer_phone,house,visit_date,arrival_time,people_count,table_number,source,status,amount,notes,operator_reception)
 values(r.id,r.customer_id,r.customer_name,r.customer_phone,r.house,r.visit_date,r.arrival_time,r.people_count,r.table_number,r.source,r.status,r.amount,r.notes,r.operator_reception)
 on conflict(id) do update set customer_id=excluded.customer_id,customer_name=excluded.customer_name,customer_phone=excluded.customer_phone,house=excluded.house,visit_date=excluded.visit_date,arrival_time=excluded.arrival_time,people_count=excluded.people_count,table_number=excluded.table_number,source=excluded.source,status=excluded.status,amount=excluded.amount,notes=excluded.notes,operator_reception=excluded.operator_reception;
end $$;
create function public.crm_save_reservation(payload jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare r grupo_qu4tro.reservations;
begin
 r:=jsonb_populate_record(null::grupo_qu4tro.reservations,payload);
 insert into grupo_qu4tro.reservations(id,customer_id,customer_name,customer_phone,house,reservation_date,reservation_time,people_count,status,notes)
 values(r.id,r.customer_id,r.customer_name,r.customer_phone,r.house,r.reservation_date,r.reservation_time,r.people_count,r.status,r.notes)
 on conflict(id) do update set customer_id=excluded.customer_id,customer_name=excluded.customer_name,customer_phone=excluded.customer_phone,house=excluded.house,reservation_date=excluded.reservation_date,reservation_time=excluded.reservation_time,people_count=excluded.people_count,status=excluded.status,notes=excluded.notes;
end $$;
revoke all on function public.crm_save_visit(jsonb),public.crm_save_reservation(jsonb) from public;
grant execute on function public.crm_save_visit(jsonb),public.crm_save_reservation(jsonb) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
