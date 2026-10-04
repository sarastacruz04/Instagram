-- =====================================================================
-- Instagram Clone — esquema completo (pegar en Supabase > SQL Editor > Run)
-- La seguridad vive AQUÍ (RLS), no en la app: el cliente siempre se puede
-- manipular, Postgres no.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- PERFILES
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9._]{3,30}$'),
  full_name   text not null default '',
  bio         text not null default '',
  avatar_url  text,
  is_private  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Crea el perfil automáticamente al registrarse (username viene en metadata).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    lower(new.raw_user_meta_data ->> 'username'),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- SEGUIDORES (solicitud / aprobación)
-- ---------------------------------------------------------------------
create table public.follows (
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

-- El estado inicial lo decide el SERVIDOR según la privacidad del destino.
-- Aunque un cliente malicioso envíe status='accepted', se sobrescribe.
create function public.follows_set_initial_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select case when p.is_private then 'pending' else 'accepted' end
    into new.status
    from public.profiles p where p.id = new.following_id;
  return new;
end $$;

create trigger follows_before_insert
  before insert on public.follows
  for each row execute function public.follows_set_initial_status();

-- Regla central de privacidad: ¿el usuario actual puede ver el contenido de `owner`?
-- security definer + stable: se evalúa sin recursión de RLS y Postgres la puede cachear por fila.
create function public.can_view(owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select owner = auth.uid()
      or not (select p.is_private from public.profiles p where p.id = owner)
      or exists (
        select 1 from public.follows f
        where f.follower_id = auth.uid()
          and f.following_id = owner
          and f.status = 'accepted'
      );
$$;

-- ---------------------------------------------------------------------
-- POSTS, LIKES, COMENTARIOS
-- Los IDs los genera el CLIENTE (UUID v4) → los reintentos de la cola
-- offline son idempotentes (on conflict do nothing).
-- ---------------------------------------------------------------------
create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references public.profiles(id) on delete cascade,
  image_path    text not null,           -- ruta en el bucket privado `media`
  caption       text not null default '',
  like_count    integer not null default 0,
  comment_count integer not null default 0,
  created_at    timestamptz not null default now()
);
create index posts_author_created_idx on public.posts (author_id, created_at desc);
create index posts_created_idx on public.posts (created_at desc);

create table public.likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)          -- un like por usuario: la PK hace el like idempotente
);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  parent_id  uuid references public.comments(id) on delete cascade,  -- respuestas anidadas
  body       text not null check (length(body) between 1 and 2200),
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments (post_id, created_at);

-- Contadores desnormalizados: el feed no hace COUNT(*) por cada post.
create function public.bump_counters() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'likes' then
    update public.posts set like_count = like_count + (case when tg_op = 'INSERT' then 1 else -1 end)
    where id = coalesce(new.post_id, old.post_id);
  else
    update public.posts set comment_count = comment_count + (case when tg_op = 'INSERT' then 1 else -1 end)
    where id = coalesce(new.post_id, old.post_id);
  end if;
  return null;
end $$;

create trigger likes_counter after insert or delete on public.likes
  for each row execute function public.bump_counters();
create trigger comments_counter after insert or delete on public.comments
  for each row execute function public.bump_counters();

-- ---------------------------------------------------------------------
-- HISTORIAS (24 h)
-- ---------------------------------------------------------------------
create table public.stories (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles(id) on delete cascade,
  image_path text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index stories_author_idx on public.stories (author_id, created_at);

-- ---------------------------------------------------------------------
-- MENSAJES DIRECTOS
-- ---------------------------------------------------------------------
create table public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  user_a               uuid not null references public.profiles(id) on delete cascade,
  user_b               uuid not null references public.profiles(id) on delete cascade,
  last_message_at      timestamptz not null default now(),
  last_message_preview text not null default '',
  last_sender_id       uuid,
  created_at           timestamptz not null default now(),
  check (user_a < user_b),               -- par canónico: evita conversaciones duplicadas A-B / B-A
  unique (user_a, user_b)
);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null check (length(body) between 1 and 4000),
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz,
  read_at         timestamptz
);
create index messages_conv_idx on public.messages (conversation_id, created_at);

create function public.is_member(conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv and auth.uid() in (c.user_a, c.user_b)
  );
$$;

-- Mantiene la bandeja ordenable por el último mensaje.
create function public.touch_conversation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = left(new.body, 80),
         last_sender_id = new.sender_id
   where id = new.conversation_id;
  return null;
end $$;

create trigger messages_touch after insert on public.messages
  for each row execute function public.touch_conversation();

-- RPC: obtiene o crea la conversación 1-a-1 con `other`.
create function public.get_or_create_conversation(other uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a uuid := least(auth.uid(), other);
  b uuid := greatest(auth.uid(), other);
  conv uuid;
begin
  if auth.uid() is null or other = auth.uid() then
    raise exception 'invalid participants';
  end if;
  insert into public.conversations (user_a, user_b) values (a, b)
    on conflict (user_a, user_b) do nothing;
  select id into conv from public.conversations where user_a = a and user_b = b;
  return conv;
end $$;

-- RPC: el DESTINATARIO confirma entrega / lectura. Solo toca mensajes del otro.
create function public.mark_delivered(conv uuid) returns void
language sql security definer set search_path = '' as $$
  update public.messages set delivered_at = now()
   where conversation_id = conv and sender_id <> auth.uid()
     and delivered_at is null and public.is_member(conv);
$$;

create function public.mark_read(conv uuid) returns void
language sql security definer set search_path = '' as $$
  update public.messages
     set read_at = now(), delivered_at = coalesce(delivered_at, now())
   where conversation_id = conv and sender_id <> auth.uid()
     and read_at is null and public.is_member(conv);
$$;

-- ---------------------------------------------------------------------
-- FEED (security invoker → se aplica RLS del usuario que llama)
-- Paginación por cursor (keyset): estable aunque lleguen posts nuevos.
-- ---------------------------------------------------------------------
create function public.get_feed(p_before timestamptz default null, p_limit int default 20)
returns table (
  id uuid, author_id uuid, image_path text, caption text, like_count int,
  comment_count int, created_at timestamptz, username text, avatar_url text,
  liked_by_me boolean
)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.author_id, p.image_path, p.caption, p.like_count, p.comment_count,
         p.created_at, pr.username, pr.avatar_url,
         exists (select 1 from public.likes l where l.post_id = p.id and l.user_id = auth.uid())
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
   where (p.author_id = auth.uid()
          or exists (select 1 from public.follows f
                      where f.follower_id = auth.uid() and f.following_id = p.author_id
                        and f.status = 'accepted'))
     and (p_before is null or p.created_at < p_before)
   order by p.created_at desc
   limit p_limit;
$$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles      enable row level security;
alter table public.follows       enable row level security;
alter table public.posts         enable row level security;
alter table public.likes         enable row level security;
alter table public.comments      enable row level security;
alter table public.stories       enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

-- Perfiles: la ficha básica es visible (como en Instagram), solo tú editas la tuya.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Follows: ves tus propias relaciones; las listas de otros solo si puedes ver a esa cuenta.
create policy follows_select on public.follows for select to authenticated using (
  follower_id = auth.uid() or following_id = auth.uid()
  or (status = 'accepted' and (public.can_view(following_id) or public.can_view(follower_id)))
);
create policy follows_insert on public.follows for insert to authenticated
  with check (follower_id = auth.uid());
-- Solo el DUEÑO de la cuenta privada aprueba (pending -> accepted).
create policy follows_update on public.follows for update to authenticated
  using (following_id = auth.uid()) with check (following_id = auth.uid() and status = 'accepted');
-- Dejar de seguir / cancelar solicitud / rechazar solicitud.
create policy follows_delete on public.follows for delete to authenticated
  using (follower_id = auth.uid() or following_id = auth.uid());

-- Posts
create policy posts_select on public.posts for select to authenticated using (public.can_view(author_id));
create policy posts_insert on public.posts for insert to authenticated with check (author_id = auth.uid());
create policy posts_delete on public.posts for delete to authenticated using (author_id = auth.uid());

-- Likes / comentarios: solo sobre posts que puedes ver
create policy likes_select on public.likes for select to authenticated using (
  exists (select 1 from public.posts p where p.id = post_id)   -- el subselect ya pasa por RLS de posts
);
create policy likes_insert on public.likes for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id)
);
create policy likes_delete on public.likes for delete to authenticated using (user_id = auth.uid());

create policy comments_select on public.comments for select to authenticated using (
  exists (select 1 from public.posts p where p.id = post_id)
);
create policy comments_insert on public.comments for insert to authenticated with check (
  author_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id)
);
create policy comments_delete on public.comments for delete to authenticated using (author_id = auth.uid());

-- Historias: visibles 24 h y solo si puedes ver al autor
create policy stories_select on public.stories for select to authenticated
  using (expires_at > now() and public.can_view(author_id));
create policy stories_insert on public.stories for insert to authenticated with check (author_id = auth.uid());
create policy stories_delete on public.stories for delete to authenticated using (author_id = auth.uid());

-- DMs: solo los dos participantes
create policy conversations_select on public.conversations for select to authenticated
  using (auth.uid() in (user_a, user_b));
create policy messages_select on public.messages for select to authenticated
  using (public.is_member(conversation_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id));

-- =====================================================================
-- STORAGE
--  media   (privado): <uid>/posts/<uuid>.jpg, <uid>/stories/<uuid>.jpg → URLs firmadas
--  avatars (público): <uid>/avatar.jpg
-- =====================================================================
insert into storage.buckets (id, name, public) values ('media', 'media', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

create policy media_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
);
-- La imagen de una cuenta privada solo se puede firmar/descargar si can_view(dueño).
create policy media_select on storage.objects for select to authenticated using (
  bucket_id = 'media' and public.can_view(((storage.foldername(name))[1])::uuid)
);
create policy media_delete on storage.objects for delete to authenticated using (
  bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
);

create policy avatars_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy avatars_update on storage.objects for update to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy avatars_select on storage.objects for select using (bucket_id = 'avatars');

-- =====================================================================
-- REALTIME (WebSockets): tablas que emiten postgres_changes.
-- Realtime respeta RLS: cada suscriptor solo recibe filas que puede ver.
-- =====================================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.follows;
