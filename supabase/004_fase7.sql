-- =====================================================================
-- Fase 7 — Historias efímeras de 24 h (pegar en Supabase > SQL Editor > Run)
-- =====================================================================

-- Historias ACTIVAS mías y de las cuentas que sigo (aceptadas), con datos del autor.
-- security invoker → la política stories_select (expires_at > now() AND can_view) se aplica:
-- una historia vencida o de una cuenta privada que no sigo simplemente no aparece.
-- Orden: por autor y cronológico dentro de cada autor (así se reproducen).
create function public.get_story_feed()
returns table (
  id uuid, author_id uuid, username text, avatar_url text,
  image_path text, created_at timestamptz, expires_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.author_id, p.username, p.avatar_url, s.image_path, s.created_at, s.expires_at
    from public.stories s
    join public.profiles p on p.id = s.author_id
   where s.expires_at > now()
     and (s.author_id = auth.uid()
          or exists (select 1 from public.follows f
                      where f.follower_id = auth.uid() and f.following_id = s.author_id
                        and f.status = 'accepted'))
   order by s.author_id, s.created_at;
$$;

-- Índice para el filtro por vencimiento (la consulta de arriba y la política RLS lo usan).
create index if not exists stories_expires_idx on public.stories (expires_at);
