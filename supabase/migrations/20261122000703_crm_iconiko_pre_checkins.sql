create table public.crm_pre_checkins (
 id text primary key,
 house text not null,
 business_date date not null,
 status text not null check (status in ('Aguardando','Chamado','Atendido','Desistiu')),
 checkin_pending boolean generated always as (status in ('Aguardando','Chamado')) stored,
 entry jsonb not null check (jsonb_typeof(entry) = 'object' and entry->>'id' = id and entry->>'status' = status),
 updated_at timestamptz not null default clock_timestamp()
);
create index crm_pre_checkins_house_date on public.crm_pre_checkins (house,business_date);
alter table public.crm_pre_checkins enable row level security;
revoke all on public.crm_pre_checkins from public, anon, authenticated;
grant select, insert, update on public.crm_pre_checkins to anon, authenticated;
create policy crm_pre_checkins_read on public.crm_pre_checkins for select to anon, authenticated using (house = 'iconiko');
create policy crm_pre_checkins_insert on public.crm_pre_checkins for insert to anon, authenticated with check (house = 'iconiko');
create policy crm_pre_checkins_update on public.crm_pre_checkins for update to anon, authenticated using (house = 'iconiko') with check (house = 'iconiko');
