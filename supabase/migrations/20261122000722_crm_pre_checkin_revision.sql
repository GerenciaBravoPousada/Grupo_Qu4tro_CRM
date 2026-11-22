create function public.crm_pre_checkin_revision() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('Atendido','Desistiu') then
    raise exception 'Pré-check-in encerrado' using errcode = '23514';
  end if;
  if new.id <> old.id or new.house <> old.house or new.business_date <> old.business_date then
    raise exception 'Identidade do pré-check-in é imutável' using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger crm_pre_checkin_revision before update on public.crm_pre_checkins for each row execute function public.crm_pre_checkin_revision();
