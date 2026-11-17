-- Derkenar: okuma hafızası şeması
-- Tablolar: sources (kaynak), quotes (alıntı/not), projects (proje), api_tokens (bağlantı kodları)
-- Her satır bir kullanıcıya aittir; RLS yalnızca sahibine erişim verir.

create table public.sources (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null default 'other' check (kind in ('pdf', 'web', 'book', 'article', 'other')),
  title       text not null default '',
  author      text not null default '',
  year        text not null default '',
  container   text not null default '',
  url         text not null default '',
  file_name   text not null default '',
  fingerprint text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.quotes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_id   uuid references public.sources (id) on delete cascade,
  text        text not null default '',
  note        text not null default '',
  page        text not null default '',
  color       text not null default '',
  tags        text[] not null default '{}',
  project_ids uuid[] not null default '{}',
  origin      text not null default 'manual',
  device      text not null default '',
  fingerprint text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create table public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  token_hash   text not null unique,
  label        text not null default '',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index sources_user_idx on public.sources (user_id);
create index projects_user_idx on public.projects (user_id);
create index quotes_user_created_idx on public.quotes (user_id, created_at desc);
create index quotes_source_idx on public.quotes (source_id);
create index api_tokens_user_idx on public.api_tokens (user_id);

alter table public.sources enable row level security;
alter table public.projects enable row level security;
alter table public.quotes enable row level security;
alter table public.api_tokens enable row level security;

create policy sources_owner on public.sources for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy projects_owner on public.projects for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy quotes_owner on public.quotes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy api_tokens_owner on public.api_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.sources, public.projects, public.quotes, public.api_tokens from anon;
grant select, insert, update, delete on public.sources, public.projects, public.quotes to authenticated;
grant select, insert, delete on public.api_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- Bağlantı koduyla (token) çalışan yakalama fonksiyonları.
-- Tarayıcı eklentisi ve Mac kısayolu oturum açmadan bu fonksiyonları çağırır.
-- Token veritabanında yalnızca SHA-256 özeti olarak saklanır.
-- ---------------------------------------------------------------------------

create function public.derkenar_token_user(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'Geçersiz bağlantı kodu' using errcode = '28000';
  end if;
  update public.api_tokens
     set last_used_at = now()
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  returning user_id into v_user;
  if v_user is null then
    raise exception 'Geçersiz bağlantı kodu' using errcode = '28000';
  end if;
  return v_user;
end $$;

revoke all on function public.derkenar_token_user(text) from public, anon, authenticated;

create function public.capture(p_token text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user      uuid := public.derkenar_token_user(p_token);
  v_text      text := btrim(coalesce(p_payload ->> 'text', ''));
  v_note      text := btrim(coalesce(p_payload ->> 'note', ''));
  v_url       text := btrim(coalesce(p_payload ->> 'url', ''));
  v_title     text := btrim(coalesce(p_payload ->> 'title', ''));
  v_file      text := btrim(coalesce(p_payload ->> 'file_name', ''));
  v_kind      text := coalesce(nullif(p_payload ->> 'kind', ''), 'other');
  v_source_fp text := nullif(p_payload ->> 'source_fingerprint', '');
  v_source    uuid;
  v_quote     uuid;
  v_quote_fp  text;
  v_tags      text[];
begin
  if v_text = '' and v_note = '' then
    raise exception 'Kaydedilecek metin yok' using errcode = '22023';
  end if;
  if length(v_text) > 20000 or length(v_note) > 20000 then
    raise exception 'Metin çok uzun' using errcode = '22023';
  end if;
  if v_kind not in ('pdf', 'web', 'book', 'article', 'other') then
    v_kind := 'other';
  end if;

  -- Kaynağı bul: önce parmak izi, sonra dosya adı, sonra adres.
  if v_source_fp is not null then
    select id into v_source from public.sources
     where user_id = v_user and fingerprint = v_source_fp limit 1;
  end if;
  if v_source is null and v_file <> '' then
    select id into v_source from public.sources
     where user_id = v_user and lower(file_name) = lower(v_file)
     order by created_at limit 1;
  end if;
  if v_source is null and v_url <> '' then
    select id into v_source from public.sources
     where user_id = v_user and url = v_url
     order by created_at limit 1;
  end if;

  if v_source is null and (v_source_fp is not null or v_file <> '' or v_url <> '' or v_title <> '') then
    if v_source_fp is null then
      v_source_fp := case
        when v_url <> '' then 'url:' || v_url
        when v_file <> '' then 'file:' || lower(v_file)
        else 'title:' || lower(v_title)
      end;
    end if;
    insert into public.sources (user_id, kind, title, author, year, url, file_name, fingerprint)
    values (
      v_user, v_kind,
      coalesce(nullif(v_title, ''), nullif(v_file, ''), v_url),
      btrim(coalesce(p_payload ->> 'author', '')),
      btrim(coalesce(p_payload ->> 'year', '')),
      v_url, v_file, v_source_fp
    )
    on conflict (user_id, fingerprint) do update set updated_at = now()
    returning id into v_source;
  end if;

  select coalesce(array_agg(t), '{}') into v_tags
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_payload -> 'tags') = 'array' then p_payload -> 'tags' else '[]'::jsonb end
    ) as t;

  -- Aynı seçimin yanlışlıkla iki kez kaydedilmesini engelle.
  v_quote_fp := 'cap:' || md5(coalesce(v_source::text, '') || '|' || v_text || '|' || v_note);

  insert into public.quotes (user_id, source_id, text, note, page, color, tags, origin, device, fingerprint)
  values (
    v_user, v_source, v_text, v_note,
    btrim(coalesce(p_payload ->> 'page', '')),
    coalesce(p_payload ->> 'color', ''),
    v_tags,
    coalesce(nullif(p_payload ->> 'origin', ''), 'capture'),
    coalesce(p_payload ->> 'device', ''),
    v_quote_fp
  )
  on conflict (user_id, fingerprint) do nothing
  returning id into v_quote;

  if v_quote is null then
    select id into v_quote from public.quotes where user_id = v_user and fingerprint = v_quote_fp;
    return jsonb_build_object('quote_id', v_quote, 'source_id', v_source, 'duplicate', true);
  end if;

  if v_source is not null then
    update public.sources set updated_at = now() where id = v_source;
  end if;
  return jsonb_build_object('quote_id', v_quote, 'source_id', v_source, 'duplicate', false);
end $$;

-- Bir sayfa adresine ait alıntılar (eklentinin yan paneli için).
create function public.quotes_for_url(p_token text, p_url text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.derkenar_token_user(p_token);
  v_out  jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'text', q.text, 'note', q.note, 'page', q.page,
           'tags', q.tags, 'created_at', q.created_at) order by q.created_at), '[]'::jsonb)
    into v_out
    from public.quotes q
    join public.sources s on s.id = q.source_id
   where q.user_id = v_user and s.url = p_url;
  return v_out;
end $$;

-- Eklentiden not/etiket güncelleme. p_patch: {"note": "...", "tags": ["a","b"]}
create function public.token_update_quote(p_token text, p_id text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.derkenar_token_user(p_token);
  v_n    int;
begin
  update public.quotes q
     set note = case when p_patch ? 'note' then coalesce(p_patch ->> 'note', '') else q.note end,
         tags = case when jsonb_typeof(p_patch -> 'tags') = 'array'
                     then coalesce((select array_agg(t) from jsonb_array_elements_text(p_patch -> 'tags') as t), '{}')
                     else q.tags end,
         updated_at = now()
   where q.id = p_id::uuid and q.user_id = v_user;
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n);
end $$;

create function public.token_delete_quote(p_token text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.derkenar_token_user(p_token);
  v_n    int;
begin
  delete from public.quotes where id = p_id::uuid and user_id = v_user;
  get diagnostics v_n = row_count;
  return jsonb_build_object('deleted', v_n);
end $$;

-- Bağlantı testi: kod geçerliyse alıntı ve kaynak sayısını döndürür.
create function public.token_status(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.derkenar_token_user(p_token);
begin
  return jsonb_build_object(
    'ok', true,
    'quotes', (select count(*) from public.quotes where user_id = v_user),
    'sources', (select count(*) from public.sources where user_id = v_user)
  );
end $$;

revoke all on function public.capture(text, jsonb) from public;
revoke all on function public.quotes_for_url(text, text) from public;
revoke all on function public.token_update_quote(text, text, jsonb) from public;
revoke all on function public.token_delete_quote(text, text) from public;
revoke all on function public.token_status(text) from public;
grant execute on function public.capture(text, jsonb) to anon, authenticated;
grant execute on function public.quotes_for_url(text, text) to anon, authenticated;
grant execute on function public.token_update_quote(text, text, jsonb) to anon, authenticated;
grant execute on function public.token_delete_quote(text, text) to anon, authenticated;
grant execute on function public.token_status(text) to anon, authenticated;

-- Alıntısı olan sayfa adresleri. Eklenti bunu önbelleğe alır; böylece gezdiğin her sayfanın
-- adresini sunucuya sormadan, yalnızca alıntın olan sayfalarda vurguları geri getirir.
create function public.source_urls(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.derkenar_token_user(p_token);
begin
  return (select coalesce(jsonb_agg(distinct s.url), '[]'::jsonb)
            from public.sources s
           where s.user_id = v_user and s.url <> ''
             and exists (select 1 from public.quotes q where q.source_id = s.id));
end $$;

revoke all on function public.source_urls(text) from public;
grant execute on function public.source_urls(text) to anon, authenticated;
