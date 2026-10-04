-- =====================================================================
-- Fase 4 — funciones de lectura (pegar en Supabase > SQL Editor > Run)
-- Todas devuelven la MISMA forma de fila que get_feed, así el cliente usa un solo mapper.
-- security invoker → RLS del usuario que llama: un post privado simplemente no aparece.
-- =====================================================================

-- Un post por id (detalle / deep link)
create function public.get_post(p_id uuid)
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
   where p.id = p_id;
$$;

-- Posts de un usuario (grilla del perfil), paginados por cursor
create function public.get_user_posts(p_user uuid, p_before timestamptz default null, p_limit int default 30)
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
   where p.author_id = p_user
     and (p_before is null or p.created_at < p_before)
   order by p.created_at desc
   limit p_limit;
$$;

-- Explorar: posts recientes de cuentas que puedo ver (RLS filtra las privadas), menos los míos
create function public.get_explore(p_before timestamptz default null, p_limit int default 30)
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
   where p.author_id <> auth.uid()
     and (p_before is null or p.created_at < p_before)
   order by p.created_at desc
   limit p_limit;
$$;

-- Contadores del perfil. security DEFINER a propósito: como en Instagram, los NÚMEROS de una
-- cuenta privada son públicos, pero las LISTAS (quién sigue a quién) siguen protegidas por RLS.
create function public.get_profile_stats(p_user uuid)
returns table (posts int, followers int, following int)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::int from public.posts where author_id = p_user),
    (select count(*)::int from public.follows where following_id = p_user and status = 'accepted'),
    (select count(*)::int from public.follows where follower_id = p_user and status = 'accepted');
$$;

-- Actividad: likes y comentarios recientes en MIS posts (de otras personas)
create function public.get_activity(p_limit int default 50)
returns table (kind text, actor_id uuid, username text, avatar_url text, post_id uuid,
               image_path text, body text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select * from (
    select 'like'::text, l.user_id, pr.username, pr.avatar_url, p.id, p.image_path, null::text, l.created_at
      from public.likes l
      join public.posts p on p.id = l.post_id and p.author_id = auth.uid()
      join public.profiles pr on pr.id = l.user_id
     where l.user_id <> auth.uid()
    union all
    select 'comment', c.author_id, pr.username, pr.avatar_url, p.id, p.image_path, c.body, c.created_at
      from public.comments c
      join public.posts p on p.id = c.post_id and p.author_id = auth.uid()
      join public.profiles pr on pr.id = c.author_id
     where c.author_id <> auth.uid()
  ) a
  order by 8 desc
  limit p_limit;
$$;

-- Subida idempotente: la cola offline reintenta el upload con upsert → necesita UPDATE en su carpeta.
create policy media_update on storage.objects for update to authenticated using (
  bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
);

-- Al volver una cuenta PÚBLICA, las solicitudes pendientes se aceptan solas (como Instagram).
create function public.accept_pending_on_public() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.is_private and not new.is_private then
    update public.follows set status = 'accepted'
     where following_id = new.id and status = 'pending';
  end if;
  return new;
end $$;

create trigger profiles_privacy_change after update of is_private on public.profiles
  for each row execute function public.accept_pending_on_public();
