-- DiceDrop v0.2.0: operator console + worker API
-- DiceDrop is now operator-only. Clients send orders through the API and never sign in.
-- Buyer accounts and boxes belong to the platform, not to a client.

-- ---------------------------------------------------------------------------
-- Platform settings
-- ---------------------------------------------------------------------------
create table if not exists public.platform_settings (
  id int primary key default 1 check (id = 1),
  timezone text not null default 'America/Chicago'
);
insert into public.platform_settings (id) values (1) on conflict (id) do nothing;
alter table public.platform_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Boxes become platform-owned and gain worker fields
-- ---------------------------------------------------------------------------
drop policy if exists boxes_select on public.boxes;
alter table public.boxes drop column if exists workspace_id;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'boxes_name_key') then
    alter table public.boxes add constraint boxes_name_key unique (name);
  end if;
end $$;
alter table public.boxes
  add column if not exists token_hash text unique,
  add column if not exists token_prefix text,
  add column if not exists desired_state text not null default 'run' check (desired_state in ('run', 'pause', 'drain')),
  add column if not exists reported_state text,
  add column if not exists hostname text,
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz,
  add column if not exists notes text;

-- ---------------------------------------------------------------------------
-- Buyer accounts become a shared pool, with an optional "reserved for" client
-- ---------------------------------------------------------------------------
drop policy if exists accounts_select on public.buyer_accounts;
drop policy if exists accounts_insert on public.buyer_accounts;
drop policy if exists accounts_update on public.buyer_accounts;
alter table public.buyer_accounts drop constraint if exists buyer_accounts_workspace_id_label_key;
alter table public.buyer_accounts drop constraint if exists buyer_accounts_workspace_id_fkey;
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'buyer_accounts' and column_name = 'workspace_id') then
    alter table public.buyer_accounts rename column workspace_id to reserved_for;
  end if;
end $$;
alter table public.buyer_accounts alter column reserved_for drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'buyer_accounts_reserved_for_fkey') then
    alter table public.buyer_accounts add constraint buyer_accounts_reserved_for_fkey
      foreign key (reserved_for) references public.workspaces(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'buyer_accounts_label_key') then
    alter table public.buyer_accounts add constraint buyer_accounts_label_key unique (label);
  end if;
end $$;
alter table public.buyer_accounts
  add column if not exists session_state text not null default 'unknown'
    check (session_state in ('unknown', 'signed_in', 'needs_sign_in', 'verification', 'locked')),
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz;

-- ---------------------------------------------------------------------------
-- Access: operators see and manage everything. Nobody else gets anything.
-- ---------------------------------------------------------------------------
drop function if exists public.dd_create_workspace(text);
drop function if exists public.dd_board(uuid);
drop function if exists public.dd_platform_overview();

drop policy if exists keys_select on public.api_keys;
drop policy if exists keys_insert on public.api_keys;
drop policy if exists keys_update on public.api_keys;
drop policy if exists selectors_select on public.selectors;
drop policy if exists tax_select on public.state_tax_rates;

drop policy if exists ops_workspaces on public.workspaces;
create policy ops_workspaces on public.workspaces for all to authenticated
  using (public.dd_is_platform_admin()) with check (public.dd_is_platform_admin());
drop policy if exists ops_boxes on public.boxes;
create policy ops_boxes on public.boxes for all to authenticated
  using (public.dd_is_platform_admin()) with check (public.dd_is_platform_admin());
drop policy if exists ops_accounts on public.buyer_accounts;
create policy ops_accounts on public.buyer_accounts for all to authenticated
  using (public.dd_is_platform_admin()) with check (public.dd_is_platform_admin());
drop policy if exists ops_keys on public.api_keys;
create policy ops_keys on public.api_keys for all to authenticated
  using (public.dd_is_platform_admin()) with check (public.dd_is_platform_admin());
drop policy if exists ops_orders on public.orders;
create policy ops_orders on public.orders for select to authenticated
  using (public.dd_is_platform_admin());
drop policy if exists ops_events on public.order_events;
create policy ops_events on public.order_events for select to authenticated
  using (public.dd_is_platform_admin());
drop policy if exists ops_selectors on public.selectors;
create policy ops_selectors on public.selectors for all to authenticated
  using (public.dd_is_platform_admin()) with check (public.dd_is_platform_admin());
drop policy if exists ops_tax on public.state_tax_rates;
create policy ops_tax on public.state_tax_rates for all to authenticated
  using (public.dd_is_platform_admin()) with check (public.dd_is_platform_admin());
drop policy if exists ops_settings on public.platform_settings;
create policy ops_settings on public.platform_settings for all to authenticated
  using (public.dd_is_platform_admin()) with check (public.dd_is_platform_admin());
drop policy if exists ops_admins on public.platform_admins;
create policy ops_admins on public.platform_admins for select to authenticated
  using (public.dd_is_platform_admin());

grant select, insert, update, delete on public.workspaces, public.boxes, public.buyer_accounts,
  public.api_keys, public.selectors, public.state_tax_rates to authenticated;
grant select, update on public.platform_settings to authenticated;
grant select on public.platform_admins to authenticated;

-- ---------------------------------------------------------------------------
-- Order actions (operator only). Retry also frees an order stuck in "ordering".
-- ---------------------------------------------------------------------------
create or replace function public.dd_apply_order_action(p_order uuid, p_action text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then
    raise exception 'order not found';
  end if;

  if p_action = 'cancel' then
    if o.status in ('pending', 'held', 'issue') then
      update public.orders set status = 'cancelled', cancel_requested = false where id = p_order;
    elsif o.status in ('ordering', 'ordered') then
      update public.orders set cancel_requested = true where id = p_order;
    else
      raise exception 'order is already % and cannot be cancelled here', o.status;
    end if;
  elsif p_action = 'hold' then
    if o.status in ('pending', 'issue') then
      update public.orders set status = 'held' where id = p_order;
    else
      raise exception 'only pending or flagged orders can be held (this one is %)', o.status;
    end if;
  elsif p_action = 'retry' then
    if o.status in ('issue', 'held', 'cancelled')
       or (o.status = 'ordering' and o.claimed_at < now() - interval '10 minutes') then
      update public.orders
        set status = 'pending', issue_reason = null, issue_screenshot_url = null,
            buyer_account_id = null, box_id = null, claimed_at = null, cancel_requested = false
        where id = p_order;
    else
      raise exception 'only flagged, held, cancelled, or stuck orders can be retried (this one is %)', o.status;
    end if;
  else
    raise exception 'unknown action %', p_action;
  end if;

  insert into public.order_events (workspace_id, order_id, type, actor)
    values (o.workspace_id, p_order, p_action, p_actor);

  return (select to_jsonb(x) from public.orders x where x.id = p_order);
end;
$$;

create or replace function public.dd_order_action(p_order uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.dd_is_platform_admin() then
    raise exception 'operators only';
  end if;
  return public.dd_apply_order_action(
    p_order, p_action, 'user:' || coalesce(auth.jwt() ->> 'email', auth.uid()::text)
  );
end;
$$;

create or replace function public.dd_day_start()
returns timestamptz language sql stable security definer set search_path = public as $$
  select date_trunc('day', now() at time zone s.timezone) at time zone s.timezone
  from public.platform_settings s where s.id = 1;
$$;

-- ---------------------------------------------------------------------------
-- Console data: one call per page
-- ---------------------------------------------------------------------------
create or replace function public.dd_ops_orders(p_client uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz := public.dd_day_start();
begin
  if not public.dd_is_platform_admin() then
    raise exception 'operators only';
  end if;

  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select o.id, o.status, o.cancel_requested, o.source, o.order_number, o.line_id, o.store_code,
               o.title, o.photo_url, o.asin, o.quantity, o.buyer_name, o.buyer_username,
               o.ship_state, o.sale_price, o.sale_fees, o.est_cost, o.buy_cost, o.profit,
               o.amazon_order_id, o.tracking_number, o.carrier, o.issue_reason,
               o.created_at, o.updated_at, o.claimed_at, o.placed_at, o.shipped_at, o.delivered_at,
               o.workspace_id as client_id, w.name as client_name,
               a.label as account_label, b.name as box_name,
               (o.status = 'ordering' and o.claimed_at < now() - interval '10 minutes') as stuck
        from public.orders o
        join public.workspaces w on w.id = o.workspace_id
        left join public.buyer_accounts a on a.id = o.buyer_account_id
        left join public.boxes b on b.id = o.box_id
        where p_client is null or o.workspace_id = p_client
        order by o.created_at desc
        limit 500
      ) x
    ), '[]'::jsonb),
    'total_orders', (select count(*) from public.orders o where p_client is null or o.workspace_id = p_client),
    'spent_today', coalesce((
      select sum(buy_cost) from public.orders o
      where (p_client is null or o.workspace_id = p_client) and o.placed_at >= v_start
    ), 0),
    'pending_count', (
      select count(*) from public.orders o
      where (p_client is null or o.workspace_id = p_client) and o.status in ('pending', 'ordering')
    ),
    'pending_missing_cost', (
      select count(*) from public.orders o
      where (p_client is null or o.workspace_id = p_client) and o.status in ('pending', 'ordering') and o.est_cost is null
    ),
    'pending_cogs', coalesce((
      select sum(est_cost) from public.orders o
      where (p_client is null or o.workspace_id = p_client) and o.status in ('pending', 'ordering')
    ), 0),
    'pending_tax', coalesce((
      select round(sum(o.est_cost * coalesce(r.rate, 0) / 100), 2)
      from public.orders o
      left join public.state_tax_rates r on r.state = upper(o.ship_state)
      where (p_client is null or o.workspace_id = p_client) and o.status in ('pending', 'ordering')
    ), 0),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) order by w.name) from public.workspaces w
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.dd_ops_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz := public.dd_day_start();
begin
  if not public.dd_is_platform_admin() then
    raise exception 'operators only';
  end if;

  return jsonb_build_object(
    'orders', jsonb_build_object(
      'received_24h', (select count(*) from public.orders where created_at > now() - interval '24 hours'),
      'placed_24h', (select count(*) from public.orders where placed_at > now() - interval '24 hours'),
      'pending', (select count(*) from public.orders where status = 'pending'),
      'ordering', (select count(*) from public.orders where status = 'ordering'),
      'stuck', (select count(*) from public.orders where status = 'ordering' and claimed_at < now() - interval '10 minutes'),
      'issues', (select count(*) from public.orders where status = 'issue'),
      'held', (select count(*) from public.orders where status = 'held'),
      'awaiting_tracking', (select count(*) from public.orders where status = 'ordered'),
      'oldest_pending_minutes', (
        select floor(extract(epoch from now() - min(created_at)) / 60)::int from public.orders where status = 'pending'
      ),
      'spent_today', coalesce((select sum(buy_cost) from public.orders where placed_at >= v_start), 0)
    ),
    'boxes', jsonb_build_object(
      'total', (select count(*) from public.boxes),
      'online', (select count(*) from public.boxes where last_heartbeat > now() - interval '90 seconds'),
      'paused', (select count(*) from public.boxes where desired_state <> 'run')
    ),
    'accounts', jsonb_build_object(
      'total', (select count(*) from public.buyer_accounts),
      'ready', (
        select count(*) from public.buyer_accounts a join public.boxes b on b.id = a.box_id
        where a.status in ('active', 'warming') and a.session_state in ('signed_in', 'unknown')
          and b.last_heartbeat > now() - interval '90 seconds' and b.desired_state = 'run'
      ),
      'attention', (
        select count(*) from public.buyer_accounts
        where status = 'locked' or session_state in ('needs_sign_in', 'verification', 'locked')
      ),
      'paused', (select count(*) from public.buyer_accounts where status = 'paused'),
      'unassigned', (select count(*) from public.buyer_accounts where box_id is null)
    ),
    'clients', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.orders_24h desc, c.name)
      from (
        select w.id, w.name, w.status,
          (select count(*) from public.orders o where o.workspace_id = w.id and o.created_at > now() - interval '24 hours') as orders_24h,
          (select count(*) from public.orders o where o.workspace_id = w.id and o.status in ('pending', 'ordering')) as pending,
          (select count(*) from public.orders o where o.workspace_id = w.id and o.status = 'issue') as issues,
          (select max(o.created_at) from public.orders o where o.workspace_id = w.id) as last_order_at
        from public.workspaces w
      ) c
    ), '[]'::jsonb),
    'issues', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.updated_at desc)
      from (
        select o.id, o.order_number, o.title, o.issue_reason, o.updated_at,
               w.name as client_name, a.label as account_label, b.name as box_name
        from public.orders o
        join public.workspaces w on w.id = o.workspace_id
        left join public.buyer_accounts a on a.id = o.buyer_account_id
        left join public.boxes b on b.id = o.box_id
        where o.status = 'issue'
        order by o.updated_at desc
        limit 10
      ) i
    ), '[]'::jsonb),
    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'received', h.received, 'placed', h.placed) order by h.hour)
      from (
        select g.hour,
          (select count(*) from public.orders o where o.created_at >= g.hour and o.created_at < g.hour + interval '1 hour') as received,
          (select count(*) from public.orders o where o.placed_at >= g.hour and o.placed_at < g.hour + interval '1 hour') as placed
        from generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') as g(hour)
      ) h
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.dd_ops_clients()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz := public.dd_day_start();
begin
  if not public.dd_is_platform_admin() then
    raise exception 'operators only';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(c) order by c.created_at)
    from (
      select w.id, w.name, w.status, w.created_at,
        (select count(*) from public.orders o where o.workspace_id = w.id) as orders_total,
        (select count(*) from public.orders o where o.workspace_id = w.id and o.created_at > now() - interval '24 hours') as orders_24h,
        coalesce((select sum(o.buy_cost) from public.orders o where o.workspace_id = w.id and o.placed_at >= v_start), 0) as spent_today,
        (select count(*) from public.orders o where o.workspace_id = w.id and o.status in ('pending', 'ordering')) as pending,
        (select count(*) from public.orders o where o.workspace_id = w.id and o.status = 'issue') as issues,
        (select max(o.created_at) from public.orders o where o.workspace_id = w.id) as last_order_at,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', k.id, 'name', k.name, 'key_prefix', k.key_prefix, 'webhook_url', k.webhook_url,
            'created_at', k.created_at, 'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at,
            'orders_24h', (select count(*) from public.orders o where o.api_key_id = k.id and o.created_at > now() - interval '24 hours')
          ) order by k.created_at)
          from public.api_keys k where k.workspace_id = w.id
        ), '[]'::jsonb) as keys
      from public.workspaces w
    ) c
  ), '[]'::jsonb);
end;
$$;

create or replace function public.dd_ops_accounts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz := public.dd_day_start();
begin
  if not public.dd_is_platform_admin() then
    raise exception 'operators only';
  end if;

  return jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.label)
      from (
        select a.id, a.label, a.login_email, a.status, a.session_state, a.daily_order_cap, a.daily_spend_cap,
               a.proxy_label, a.card_bank, a.card_last4, a.notes, a.last_seen_at, a.last_error, a.last_error_at,
               a.box_id, b.name as box_name,
               (b.last_heartbeat > now() - interval '90 seconds') as box_online,
               a.reserved_for, w.name as reserved_for_name,
               (select count(*) from public.orders o where o.buyer_account_id = a.id and o.claimed_at >= v_start
                  and o.status in ('ordering', 'ordered', 'shipped', 'delivered')) as orders_today,
               coalesce((select sum(o.buy_cost) from public.orders o where o.buyer_account_id = a.id and o.placed_at >= v_start), 0) as spent_today,
               (select count(*) from public.orders o where o.buyer_account_id = a.id) as orders_total,
               (select count(*) from public.orders o where o.buyer_account_id = a.id and o.status = 'issue') as open_issues,
               (select o.order_number from public.orders o where o.buyer_account_id = a.id and o.status = 'ordering' limit 1) as current_order
        from public.buyer_accounts a
        left join public.boxes b on b.id = a.box_id
        left join public.workspaces w on w.id = a.reserved_for
      ) x
    ), '[]'::jsonb),
    'boxes', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name) from public.boxes b), '[]'::jsonb),
    'clients', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) order by w.name) from public.workspaces w), '[]'::jsonb)
  );
end;
$$;

create or replace function public.dd_ops_boxes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz := public.dd_day_start();
begin
  if not public.dd_is_platform_admin() then
    raise exception 'operators only';
  end if;

  return jsonb_build_object(
    'boxes', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.name)
      from (
        select b.id, b.name, b.hostname, b.worker_version, b.desired_state, b.reported_state, b.token_prefix,
               b.last_heartbeat, b.last_error, b.last_error_at, b.notes, b.created_at,
               case when b.last_heartbeat is null then 'never'
                    when b.last_heartbeat > now() - interval '90 seconds' then 'online'
                    else 'offline' end as connection,
               (select count(*) from public.orders o where o.box_id = b.id and o.placed_at >= v_start) as placed_today,
               (select count(*) from public.orders o where o.box_id = b.id and o.status = 'issue') as open_issues,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'id', o.id, 'order_number', o.order_number, 'title', o.title, 'claimed_at', o.claimed_at,
                   'account_label', a.label,
                   'stuck', o.claimed_at < now() - interval '10 minutes'
                 ) order by o.claimed_at)
                 from public.orders o left join public.buyer_accounts a on a.id = o.buyer_account_id
                 where o.box_id = b.id and o.status = 'ordering'
               ), '[]'::jsonb) as working,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'id', a.id, 'label', a.label, 'status', a.status, 'session_state', a.session_state,
                   'daily_order_cap', a.daily_order_cap, 'last_seen_at', a.last_seen_at, 'last_error', a.last_error,
                   'orders_today', (select count(*) from public.orders o where o.buyer_account_id = a.id and o.claimed_at >= v_start
                                      and o.status in ('ordering', 'ordered', 'shipped', 'delivered'))
                 ) order by a.label)
                 from public.buyer_accounts a where a.box_id = b.id
               ), '[]'::jsonb) as accounts
        from public.boxes b
      ) x
    ), '[]'::jsonb),
    'queue', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.ship_by nulls last, q.created_at)
      from (
        select o.id, o.order_number, o.title, o.created_at, o.ship_by, w.name as client_name
        from public.orders o join public.workspaces w on w.id = o.workspace_id
        where o.status = 'pending' and w.status = 'active'
        order by o.ship_by nulls last, o.created_at
        limit 5
      ) q
    ), '[]'::jsonb),
    'pending_total', (select count(*) from public.orders where status = 'pending')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Worker API: each box authenticates with its own token
-- ---------------------------------------------------------------------------
create or replace function public.dd_worker_auth(p_token text)
returns public.boxes language plpgsql security definer set search_path = public as $$
declare
  b public.boxes%rowtype;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'That box token is not active.' using errcode = 'DD401';
  end if;
  select * into b from public.boxes
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    raise exception 'That box token is not active.' using errcode = 'DD401';
  end if;
  return b;
end;
$$;

-- The box checks in, reports its state, and receives its instructions.
create or replace function public.dd_worker_heartbeat(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.boxes%rowtype;
  acct jsonb;
  v_err text := nullif(p_payload ->> 'error', '');
  v_start timestamptz := public.dd_day_start();
begin
  b := public.dd_worker_auth(p_token);

  update public.boxes set
    last_heartbeat = now(),
    status = 'online',
    worker_version = coalesce(nullif(p_payload ->> 'version', ''), worker_version),
    hostname = coalesce(nullif(p_payload ->> 'hostname', ''), hostname),
    reported_state = coalesce(nullif(p_payload ->> 'state', ''), reported_state),
    last_error = coalesce(v_err, last_error),
    last_error_at = case when v_err is not null then now() else last_error_at end
  where id = b.id;

  for acct in select * from jsonb_array_elements(coalesce(p_payload -> 'accounts', '[]'::jsonb)) loop
    update public.buyer_accounts set
      session_state = case
        when acct ->> 'session_state' in ('unknown', 'signed_in', 'needs_sign_in', 'verification', 'locked')
          then acct ->> 'session_state' else session_state end,
      last_seen_at = now(),
      last_error = nullif(acct ->> 'error', ''),
      last_error_at = case when nullif(acct ->> 'error', '') is not null then now() else last_error_at end
    where box_id = b.id and label = acct ->> 'label';
  end loop;

  return jsonb_build_object(
    'desired_state', (select desired_state from public.boxes where id = b.id),
    'box', jsonb_build_object('id', b.id, 'name', b.name),
    'server_time', now(),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'label', a.label, 'status', a.status, 'login_email', a.login_email,
        'proxy_label', a.proxy_label, 'daily_order_cap', a.daily_order_cap,
        'orders_today', (select count(*) from public.orders o where o.buyer_account_id = a.id and o.claimed_at >= v_start
                           and o.status in ('ordering', 'ordered', 'shipped', 'delivered'))
      ) order by a.label)
      from public.buyer_accounts a where a.box_id = b.id
    ), '[]'::jsonb),
    'selectors', coalesce((select jsonb_object_agg(s.key, s.value) from public.selectors s), '{}'::jsonb)
  );
end;
$$;

-- The box asks for its next order. One free account on the box is matched to the oldest waiting order.
create or replace function public.dd_worker_claim(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.boxes%rowtype;
  a public.buyer_accounts%rowtype;
  o public.orders%rowtype;
  v_start timestamptz := public.dd_day_start();
begin
  b := public.dd_worker_auth(p_token);
  if b.desired_state <> 'run' then
    return jsonb_build_object('order', null, 'reason', 'box_' || b.desired_state);
  end if;

  select acc.* into a
  from public.buyer_accounts acc
  where acc.box_id = b.id
    and acc.status in ('active', 'warming')
    and acc.session_state in ('signed_in', 'unknown')
    and not exists (select 1 from public.orders x where x.buyer_account_id = acc.id and x.status = 'ordering')
    and (select count(*) from public.orders x where x.buyer_account_id = acc.id and x.claimed_at >= v_start
           and x.status in ('ordering', 'ordered', 'shipped', 'delivered')) < acc.daily_order_cap
  order by (select count(*) from public.orders x where x.buyer_account_id = acc.id and x.claimed_at >= v_start), acc.label
  limit 1
  for update of acc skip locked;

  if not found then
    return jsonb_build_object('order', null, 'reason', 'no_free_account');
  end if;

  select ord.* into o
  from public.orders ord
  join public.workspaces w on w.id = ord.workspace_id
  where ord.status = 'pending' and w.status = 'active'
    and (a.reserved_for is null or a.reserved_for = ord.workspace_id)
  order by ord.ship_by nulls last, ord.created_at
  limit 1
  for update of ord skip locked;

  if not found then
    return jsonb_build_object('order', null, 'reason', 'queue_empty');
  end if;

  update public.orders
    set status = 'ordering', buyer_account_id = a.id, box_id = b.id, claimed_at = now()
    where id = o.id;
  insert into public.order_events (workspace_id, order_id, type, detail, actor)
    values (o.workspace_id, o.id, 'claimed', a.label, 'worker:' || b.name);

  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id, 'order_number', o.order_number, 'title', o.title, 'asin', o.asin, 'buy_url', o.buy_url,
      'quantity', o.quantity, 'est_cost', o.est_cost,
      'ship_to', jsonb_build_object(
        'name', o.ship_name, 'line1', o.ship_line1, 'line2', o.ship_line2, 'city', o.ship_city,
        'state', o.ship_state, 'postal_code', o.ship_postal, 'country', o.ship_country, 'phone', o.ship_phone
      )
    ),
    'account', jsonb_build_object('id', a.id, 'label', a.label)
  );
end;
$$;

-- The box reports what happened to an order it holds.
create or replace function public.dd_worker_report(p_token text, p_order uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.boxes%rowtype;
  o public.orders%rowtype;
  v_type text := p_result ->> 'type';
  v_acct_state text := p_result ->> 'account_state';
begin
  b := public.dd_worker_auth(p_token);
  select * into o from public.orders where id = p_order and box_id = b.id for update;
  if not found then
    raise exception 'This box does not hold that order.' using errcode = 'DD404';
  end if;

  if v_type = 'placed' and o.status = 'ordering' then
    update public.orders set status = 'ordered', placed_at = now(),
      amazon_order_id = nullif(p_result ->> 'amazon_order_id', ''),
      buy_cost = nullif(p_result ->> 'buy_cost', '')::numeric,
      buy_tax = nullif(p_result ->> 'buy_tax', '')::numeric
    where id = o.id;
  elsif v_type = 'issue' and o.status in ('ordering', 'ordered', 'shipped') then
    update public.orders set status = 'issue',
      issue_reason = coalesce(nullif(p_result ->> 'reason', ''), 'The worker reported a problem.'),
      issue_screenshot_url = nullif(p_result ->> 'screenshot_url', '')
    where id = o.id;
  elsif v_type = 'release' and o.status = 'ordering' then
    update public.orders set status = 'pending', buyer_account_id = null, box_id = null, claimed_at = null
    where id = o.id;
  elsif v_type = 'shipped' and o.status in ('ordered', 'shipped') then
    update public.orders set status = 'shipped',
      tracking_number = coalesce(nullif(p_result ->> 'tracking_number', ''), tracking_number),
      carrier = coalesce(nullif(p_result ->> 'carrier', ''), carrier),
      shipped_at = coalesce(shipped_at, now())
    where id = o.id;
  elsif v_type = 'delivered' and o.status in ('ordered', 'shipped') then
    update public.orders set status = 'delivered', delivered_at = now() where id = o.id;
  elsif v_type = 'cancelled' and o.status in ('ordering', 'ordered') then
    update public.orders set status = 'cancelled', cancel_requested = false where id = o.id;
  else
    raise exception 'A "%" report does not fit an order that is %.', coalesce(v_type, 'missing'), o.status
      using errcode = 'DD422';
  end if;

  if v_acct_state in ('unknown', 'signed_in', 'needs_sign_in', 'verification', 'locked') and o.buyer_account_id is not null then
    update public.buyer_accounts set session_state = v_acct_state, last_seen_at = now() where id = o.buyer_account_id;
  end if;

  insert into public.order_events (workspace_id, order_id, type, detail, actor)
    values (o.workspace_id, o.id, v_type, nullif(p_result ->> 'reason', ''), 'worker:' || b.name);

  return jsonb_build_object('ok', true, 'status', (select status from public.orders where id = o.id));
end;
$$;

-- Orders this box placed that still need tracking or delivery checks.
create or replace function public.dd_worker_tracking(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.boxes%rowtype;
begin
  b := public.dd_worker_auth(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_number', o.order_number, 'amazon_order_id', o.amazon_order_id, 'status', o.status,
      'cancel_requested', o.cancel_requested, 'account_label', a.label, 'placed_at', o.placed_at
    ) order by o.placed_at)
    from public.orders o join public.buyer_accounts a on a.id = o.buyer_account_id
    where a.box_id = b.id and o.status in ('ordered', 'shipped')
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.dd_worker_auth(text) from public, anon, authenticated;
revoke all on function public.dd_worker_heartbeat(text, jsonb) from public;
revoke all on function public.dd_worker_claim(text) from public;
revoke all on function public.dd_worker_report(text, uuid, jsonb) from public;
revoke all on function public.dd_worker_tracking(text) from public;
grant execute on function public.dd_worker_heartbeat(text, jsonb) to anon, authenticated;
grant execute on function public.dd_worker_claim(text) to anon, authenticated;
grant execute on function public.dd_worker_report(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.dd_worker_tracking(text) to anon, authenticated;

revoke all on function public.dd_apply_order_action(uuid, text, text) from public, anon, authenticated;
revoke all on function public.dd_order_action(uuid, text) from public, anon;
revoke all on function public.dd_day_start() from public, anon, authenticated;
revoke all on function public.dd_ops_orders(uuid) from public, anon;
revoke all on function public.dd_ops_overview() from public, anon;
revoke all on function public.dd_ops_clients() from public, anon;
revoke all on function public.dd_ops_accounts() from public, anon;
revoke all on function public.dd_ops_boxes() from public, anon;
grant execute on function public.dd_order_action(uuid, text) to authenticated;
grant execute on function public.dd_ops_orders(uuid) to authenticated;
grant execute on function public.dd_ops_overview() to authenticated;
grant execute on function public.dd_ops_clients() to authenticated;
grant execute on function public.dd_ops_accounts() to authenticated;
grant execute on function public.dd_ops_boxes() to authenticated;
