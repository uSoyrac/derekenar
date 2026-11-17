-- Renk kategorileri: her çizim rengi bir kategoridir; adlarını kullanıcı belirler.

create table public.settings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  categories jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;
create policy settings_owner on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.settings from anon;
grant select, insert, update, delete on public.settings to authenticated;

-- Eklenti için kategori adları.
create function public.user_categories(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.derkenar_token_user(p_token);
begin
  return coalesce((select s.categories from public.settings s where s.user_id = v_user), '{}'::jsonb);
end $$;

revoke all on function public.user_categories(text) from public;
grant execute on function public.user_categories(text) to anon, authenticated;

-- Sayfa alıntıları artık rengi de döndürür (eklenti vurguyu doğru renkte geri getirsin).
create or replace function public.quotes_for_url(p_token text, p_url text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.derkenar_token_user(p_token);
  v_out  jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'text', q.text, 'note', q.note, 'page', q.page, 'color', q.color,
           'tags', q.tags, 'created_at', q.created_at) order by q.created_at), '[]'::jsonb)
    into v_out
    from public.quotes q
    join public.sources s on s.id = q.source_id
   where q.user_id = v_user and s.url = p_url;
  return v_out;
end $$;

-- Eklentiden renk değiştirme de yapılabilsin. p_patch: {"note": "...", "tags": [...], "color": "#rrggbb"}
create or replace function public.token_update_quote(p_token text, p_id text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.derkenar_token_user(p_token);
  v_n    int;
begin
  update public.quotes q
     set note = case when p_patch ? 'note' then coalesce(p_patch ->> 'note', '') else q.note end,
         color = case when p_patch ? 'color' then coalesce(p_patch ->> 'color', '') else q.color end,
         tags = case when jsonb_typeof(p_patch -> 'tags') = 'array'
                     then coalesce((select array_agg(t) from jsonb_array_elements_text(p_patch -> 'tags') as t), '{}')
                     else q.tags end,
         updated_at = now()
   where q.id = p_id::uuid and q.user_id = v_user;
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n);
end $$;
