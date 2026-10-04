-- =====================================================================
-- Fase 6 — Mensajes directos (pegar en Supabase > SQL Editor > Run)
-- =====================================================================

-- Bandeja de entrada en UNA consulta: el otro participante, el último mensaje y
-- cuántos mensajes suyos no he leído. Ordenada por el último mensaje (más reciente primero).
create function public.get_inbox()
returns table (
  id uuid, other_id uuid, username text, avatar_url text,
  last_message_at timestamptz, last_message_preview text, last_sender_id uuid, unread int
)
language sql stable security invoker set search_path = '' as $$
  select c.id, o.id, o.username, o.avatar_url,
         c.last_message_at, c.last_message_preview, c.last_sender_id,
         (select count(*)::int from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.read_at is null)
    from public.conversations c
    join public.profiles o on o.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
   where auth.uid() in (c.user_a, c.user_b)
     and c.last_sender_id is not null          -- conversaciones sin mensajes no se muestran
   order by c.last_message_at desc;
$$;

-- "Entregado" para todo lo que llegó mientras mi app estaba cerrada o sin red.
create function public.mark_all_delivered() returns void
language sql security definer set search_path = '' as $$
  update public.messages m set delivered_at = now()
    from public.conversations c
   where m.conversation_id = c.id
     and auth.uid() in (c.user_a, c.user_b)
     and m.sender_id <> auth.uid()
     and m.delivered_at is null;
$$;

-- ---------------------------------------------------------------------
-- Autorización de Realtime para el canal PRIVADO de "Escribiendo…" (Broadcast).
-- El canal se llama chat:<conversation_id>. Sin estas políticas, cualquiera que
-- conociera el id podría escuchar cuándo escribes. Con ellas, solo los 2 miembros.
-- ---------------------------------------------------------------------
create function public.can_access_chat_topic(topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  -- Validar el formato ANTES de convertir a uuid (un topic malformado no debe dar error).
  if topic is null or topic !~ '^chat:[0-9a-f-]{36}$' then
    return false;
  end if;
  return public.is_member(substring(topic from 6)::uuid);
end $$;

create policy dm_channel_read on realtime.messages for select to authenticated
  using (public.can_access_chat_topic(realtime.topic()));

create policy dm_channel_write on realtime.messages for insert to authenticated
  with check (public.can_access_chat_topic(realtime.topic()));
