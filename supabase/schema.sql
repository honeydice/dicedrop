-- DiceDrop v0.1.2 schema
-- Run this once in the SQL editor of a NEW Supabase project (separate from DiceOps).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Workspaces and members
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff', 'viewer')),
  email text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.dd_is_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

create or replace function public.dd_can_write(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid() and role in ('owner', 'staff')
  );
$$;

create or replace function public.dd_is_owner(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid() and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Boxes (worker servers) and buyer accounts
-- ---------------------------------------------------------------------------
create table if not exists public.boxes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  worker_version text,
  status text not null default 'offline' check (status in ('online', 'offline', 'paused')),
  last_heartbeat timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.buyer_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label text not null,
  login_email text,
  status text not null default 'warming' check (status in ('warming', 'active', 'paused', 'locked')),
  daily_order_cap integer not null default 5,
  daily_spend_cap numeric(12, 2),
  box_id uuid references public.boxes(id) on delete set null,
  proxy_label text,
  card_bank text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  notes text,
  created_at timestamptz not null default now(),
  unique (workspace_id, label)
);

-- ---------------------------------------------------------------------------
-- API keys (one per connected app). Only a hash of the key is stored.
-- ---------------------------------------------------------------------------
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  webhook_url text,
  webhook_secret text,
  created_by text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null default 'ebay',
  order_number text not null,
  line_id text,
  store_code text,
  status text not null default 'pending'
    check (status in ('pending', 'ordering', 'ordered', 'shipped', 'delivered', 'issue', 'held', 'cancelled')),
  cancel_requested boolean not null default false,

  title text,
  photo_url text,
  asin text,
  buy_url text,
  quantity integer not null default 1 check (quantity > 0),

  buyer_name text,
  buyer_username text,
  ship_name text not null,
  ship_line1 text not null,
  ship_line2 text,
  ship_city text not null,
  ship_state text not null,
  ship_postal text not null,
  ship_country text not null default 'US',
  ship_phone text,
  ship_by timestamptz,

  sale_price numeric(12, 2),
  sale_fees numeric(12, 2),
  est_cost numeric(12, 2),
  buy_cost numeric(12, 2),
  buy_tax numeric(12, 2),
  profit numeric(12, 2) generated always as (
    case
      when buy_cost is null or sale_price is null then null
      else sale_price - coalesce(sale_fees, 0) - buy_cost
    end
  ) stored,

  buyer_account_id uuid references public.buyer_accounts(id) on delete set null,
  box_id uuid references public.boxes(id) on delete set null,
  amazon_order_id text,
  tracking_number text,
  carrier text,

  issue_reason text,
  issue_screenshot_url text,

  api_key_id uuid references public.api_keys(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  placed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz
);

-- Sending the same order twice never creates a second row.
create unique index if not exists orders_unique_ref
  on public.orders (workspace_id, source, order_number, coalesce(line_id, ''));
create index if not exists orders_ws_status on public.orders (workspace_id, status);
create index if not exists orders_ws_created on public.orders (workspace_id, created_at desc);
create index if not exists orders_ws_placed on public.orders (workspace_id, placed_at);

create or replace function public.dd_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.dd_touch_updated_at();

-- Every action on an order is stamped with who did it and when.
create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  type text not null,
  detail text,
  actor text not null,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order on public.order_events (order_id, created_at);

-- ---------------------------------------------------------------------------
-- Selectors (where Amazon's buttons and fields live) and state tax rates
-- ---------------------------------------------------------------------------
create table if not exists public.selectors (
  key text primary key,
  value text not null,
  description text,
  updated_at timestamptz not null default now()
);

insert into public.selectors (key, value, description) values
  ('product.buy_now', '#buy-now-button', 'Buy Now button on the product page'),
  ('product.price', '#corePrice_feature_div .a-offscreen', 'Current price on the product page'),
  ('product.availability', '#availability', 'In stock / out of stock text'),
  ('checkout.add_address', '#add-new-address-popover-link', 'Add a new shipping address'),
  ('checkout.place_order', 'input[name="placeYourOrder1"]', 'Place your order button'),
  ('confirmation.order_id', 'bdi', 'Order number on the confirmation page')
on conflict (key) do nothing;

-- Base state-level sales tax rates (percent). Local taxes are not included.
-- Edit any row to tighten the estimate.
create table if not exists public.state_tax_rates (
  state text primary key,
  rate numeric(6, 3) not null
);

insert into public.state_tax_rates (state, rate) values
  ('AL', 4.000), ('AK', 0.000), ('AZ', 5.600), ('AR', 6.500), ('CA', 7.250),
  ('CO', 2.900), ('CT', 6.350), ('DE', 0.000), ('DC', 6.000), ('FL', 6.000),
  ('GA', 4.000), ('HI', 4.000), ('ID', 6.000), ('IL', 6.250), ('IN', 7.000),
  ('IA', 6.000), ('KS', 6.500), ('KY', 6.000), ('LA', 5.000), ('ME', 5.500),
  ('MD', 6.000), ('MA', 6.250), ('MI', 6.000), ('MN', 6.875), ('MS', 7.000),
  ('MO', 4.225), ('MT', 0.000), ('NE', 5.500), ('NV', 6.850), ('NH', 0.000),
  ('NJ', 6.625), ('NM', 4.875), ('NY', 4.000), ('NC', 4.750), ('ND', 5.000),
  ('OH', 5.750), ('OK', 4.500), ('OR', 0.000), ('PA', 6.000), ('RI', 7.000),
  ('SC', 6.000), ('SD', 4.200), ('TN', 7.000), ('TX', 6.250), ('UT', 6.100),
  ('VT', 6.000), ('VA', 5.300), ('WA', 6.500), ('WV', 6.000), ('WI', 5.000),
  ('WY', 4.000)
on conflict (state) do nothing;

-- ---------------------------------------------------------------------------
-- Row level security: each workspace only ever sees its own data
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.boxes enable row level security;
alter table public.buyer_accounts enable row level security;
alter table public.api_keys enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
alter table public.selectors enable row level security;
alter table public.state_tax_rates enable row level security;

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select to authenticated using (public.dd_is_member(id));
drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
  for update to authenticated using (public.dd_is_owner(id)) with check (public.dd_is_owner(id));

drop policy if exists members_select on public.workspace_members;
create policy members_select on public.workspace_members
  for select to authenticated using (public.dd_is_member(workspace_id));

drop policy if exists boxes_select on public.boxes;
create policy boxes_select on public.boxes
  for select to authenticated using (public.dd_is_member(workspace_id));

drop policy if exists accounts_select on public.buyer_accounts;
create policy accounts_select on public.buyer_accounts
  for select to authenticated using (public.dd_is_member(workspace_id));
drop policy if exists accounts_insert on public.buyer_accounts;
create policy accounts_insert on public.buyer_accounts
  for insert to authenticated with check (public.dd_is_owner(workspace_id));
drop policy if exists accounts_update on public.buyer_accounts;
create policy accounts_update on public.buyer_accounts
  for update to authenticated using (public.dd_is_owner(workspace_id)) with check (public.dd_is_owner(workspace_id));

drop policy if exists keys_select on public.api_keys;
create policy keys_select on public.api_keys
  for select to authenticated using (public.dd_is_owner(workspace_id));
drop policy if exists keys_insert on public.api_keys;
create policy keys_insert on public.api_keys
  for insert to authenticated with check (public.dd_is_owner(workspace_id));
drop policy if exists keys_update on public.api_keys;
create policy keys_update on public.api_keys
  for update to authenticated using (public.dd_is_owner(workspace_id)) with check (public.dd_is_owner(workspace_id));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated using (public.dd_is_member(workspace_id));

drop policy if exists events_select on public.order_events;
create policy events_select on public.order_events
  for select to authenticated using (public.dd_is_member(workspace_id));

drop policy if exists selectors_select on public.selectors;
create policy selectors_select on public.selectors
  for select to authenticated using (true);

drop policy if exists tax_select on public.state_tax_rates;
create policy tax_select on public.state_tax_rates
  for select to authenticated using (true);

grant select on public.workspaces, public.workspace_members, public.boxes, public.buyer_accounts,
  public.api_keys, public.orders, public.order_events, public.selectors, public.state_tax_rates
  to authenticated;
grant update on public.workspaces to authenticated;
grant insert, update on public.buyer_accounts, public.api_keys to authenticated;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- First sign-in: create your workspace and become its owner.
create or replace function public.dd_create_workspace(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'workspace name is required';
  end if;
  insert into public.workspaces (name) values (trim(p_name)) returning id into v_id;
  insert into public.workspace_members (workspace_id, user_id, role, email)
    values (v_id, auth.uid(), 'owner', auth.jwt() ->> 'email');
  return v_id;
end;
$$;

-- One call returns everything the order board needs.
create or replace function public.dd_board(p_workspace uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_tz text;
  v_start timestamptz;
begin
  if not public.dd_is_member(p_workspace) then
    raise exception 'not a member of this workspace';
  end if;

  select timezone into v_tz from public.workspaces where id = p_workspace;
  v_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select o.id, o.status, o.cancel_requested, o.source, o.order_number, o.line_id, o.store_code,
               o.title, o.photo_url, o.asin, o.quantity, o.buyer_name, o.buyer_username,
               o.ship_state, o.sale_price, o.sale_fees, o.est_cost, o.buy_cost, o.profit,
               o.amazon_order_id, o.tracking_number, o.carrier, o.issue_reason,
               o.created_at, o.updated_at, o.placed_at, o.shipped_at, o.delivered_at,
               a.label as account_label
        from public.orders o
        left join public.buyer_accounts a on a.id = o.buyer_account_id
        where o.workspace_id = p_workspace
        order by o.created_at desc
        limit 500
      ) x
    ), '[]'::jsonb),
    'total_orders', (select count(*) from public.orders where workspace_id = p_workspace),
    'spent_today', coalesce((
      select sum(buy_cost) from public.orders
      where workspace_id = p_workspace and placed_at >= v_start
    ), 0),
    'spent_count', (
      select count(*) from public.orders
      where workspace_id = p_workspace and placed_at >= v_start and buy_cost is not null
    ),
    'pending_count', (
      select count(*) from public.orders
      where workspace_id = p_workspace and status in ('pending', 'ordering')
    ),
    'pending_missing_cost', (
      select count(*) from public.orders
      where workspace_id = p_workspace and status in ('pending', 'ordering') and est_cost is null
    ),
    'pending_cogs', coalesce((
      select sum(est_cost) from public.orders
      where workspace_id = p_workspace and status in ('pending', 'ordering')
    ), 0),
    'pending_tax', coalesce((
      select round(sum(o.est_cost * coalesce(r.rate, 0) / 100), 2)
      from public.orders o
      left join public.state_tax_rates r on r.state = upper(o.ship_state)
      where o.workspace_id = p_workspace and o.status in ('pending', 'ordering')
    ), 0),
    'tax_states', coalesce((
      select jsonb_agg(jsonb_build_object('state', s.state, 'rate', s.rate) order by s.state)
      from (
        select distinct upper(o.ship_state) as state, coalesce(r.rate, 0) as rate
        from public.orders o
        left join public.state_tax_rates r on r.state = upper(o.ship_state)
        where o.workspace_id = p_workspace and o.status in ('pending', 'ordering')
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

-- Core order action (retry / hold / cancel). Server-side only.
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
    if o.status in ('issue', 'held', 'cancelled') then
      update public.orders
        set status = 'pending', issue_reason = null, issue_screenshot_url = null,
            buyer_account_id = null, box_id = null, claimed_at = null, cancel_requested = false
        where id = p_order;
    else
      raise exception 'only flagged, held, or cancelled orders can be retried (this one is %)', o.status;
    end if;
  else
    raise exception 'unknown action %', p_action;
  end if;

  insert into public.order_events (workspace_id, order_id, type, actor)
    values (o.workspace_id, p_order, p_action, p_actor);

  return (select to_jsonb(x) from public.orders x where x.id = p_order);
end;
$$;

-- Backup controls from the dash: checks the signed-in user, then applies the action.
create or replace function public.dd_order_action(p_order uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.orders where id = p_order;
  if v_ws is null or not public.dd_can_write(v_ws) then
    raise exception 'you do not have access to this order';
  end if;
  return public.dd_apply_order_action(
    p_order, p_action, 'user:' || coalesce(auth.jwt() ->> 'email', auth.uid()::text)
  );
end;
$$;

revoke all on function public.dd_apply_order_action(uuid, text, text) from public, anon, authenticated;
grant execute on function public.dd_apply_order_action(uuid, text, text) to service_role;

revoke all on function public.dd_create_workspace(text) from public, anon;
revoke all on function public.dd_board(uuid) from public, anon;
revoke all on function public.dd_order_action(uuid, text) from public, anon;
grant execute on function public.dd_create_workspace(text) to authenticated;
grant execute on function public.dd_board(uuid) to authenticated;
grant execute on function public.dd_order_action(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: the board updates the moment an order changes
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public API functions (v0.1.1)
-- Every call carries the app's API key. The key is checked inside the database,
-- so the web app never needs a privileged database key.
-- ---------------------------------------------------------------------------
create or replace function public.dd_api_auth(p_key text)
returns public.api_keys language plpgsql security definer set search_path = public as $$
declare
  k public.api_keys%rowtype;
begin
  if p_key is null or length(p_key) < 20 then
    raise exception 'That API key is not active.' using errcode = 'DD401';
  end if;
  select * into k from public.api_keys
    where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex') and revoked_at is null;
  if not found then
    raise exception 'That API key is not active.' using errcode = 'DD401';
  end if;
  update public.api_keys set last_used_at = now() where id = k.id;
  return k;
end;
$$;

create or replace function public.dd_api_create_order(p_key text, p_order jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k public.api_keys%rowtype;
  o public.orders%rowtype;
  v_source text := coalesce(nullif(trim(p_order ->> 'source'), ''), 'ebay');
  v_number text := nullif(trim(p_order ->> 'order_number'), '');
  v_line text := nullif(trim(p_order ->> 'line_id'), '');
  v_dup boolean := false;
begin
  k := public.dd_api_auth(p_key);

  if v_number is null
     or (nullif(p_order ->> 'asin', '') is null and nullif(p_order ->> 'buy_url', '') is null)
     or nullif(p_order ->> 'ship_name', '') is null
     or nullif(p_order ->> 'ship_line1', '') is null
     or nullif(p_order ->> 'ship_city', '') is null
     or nullif(p_order ->> 'ship_state', '') is null
     or nullif(p_order ->> 'ship_postal', '') is null then
    raise exception 'order_number, asin (or buy_url), and a full ship_to address are required'
      using errcode = 'DD422';
  end if;

  insert into public.orders (
    workspace_id, api_key_id, source, order_number, line_id, store_code, title, photo_url,
    asin, buy_url, quantity, buyer_name, buyer_username,
    ship_name, ship_line1, ship_line2, ship_city, ship_state, ship_postal, ship_country, ship_phone, ship_by,
    sale_price, sale_fees, est_cost, metadata
  ) values (
    k.workspace_id, k.id, v_source, v_number, v_line,
    nullif(p_order ->> 'store_code', ''), nullif(p_order ->> 'title', ''), nullif(p_order ->> 'photo_url', ''),
    upper(nullif(p_order ->> 'asin', '')), nullif(p_order ->> 'buy_url', ''),
    greatest(1, coalesce((p_order ->> 'quantity')::int, 1)),
    nullif(p_order ->> 'buyer_name', ''), nullif(p_order ->> 'buyer_username', ''),
    p_order ->> 'ship_name', p_order ->> 'ship_line1', nullif(p_order ->> 'ship_line2', ''),
    p_order ->> 'ship_city', upper(p_order ->> 'ship_state'), p_order ->> 'ship_postal',
    upper(coalesce(nullif(p_order ->> 'ship_country', ''), 'US')), nullif(p_order ->> 'ship_phone', ''),
    nullif(p_order ->> 'ship_by', '')::timestamptz,
    nullif(p_order ->> 'sale_price', '')::numeric, nullif(p_order ->> 'sale_fees', '')::numeric,
    nullif(p_order ->> 'est_cost', '')::numeric,
    coalesce(p_order -> 'metadata', '{}'::jsonb)
  )
  on conflict do nothing
  returning * into o;

  if o.id is null then
    v_dup := true;
    select * into o from public.orders
      where workspace_id = k.workspace_id and source = v_source and order_number = v_number
        and coalesce(line_id, '') = coalesce(v_line, '');
  else
    insert into public.order_events (workspace_id, order_id, type, actor)
      values (k.workspace_id, o.id, 'received', 'api:' || k.name);
  end if;

  return jsonb_build_object('order', to_jsonb(o), 'duplicate', v_dup);
end;
$$;

create or replace function public.dd_api_get_order(p_key text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k public.api_keys%rowtype;
  o public.orders%rowtype;
begin
  k := public.dd_api_auth(p_key);
  select * into o from public.orders where id = p_id and workspace_id = k.workspace_id;
  if not found then
    raise exception 'No order with that id.' using errcode = 'DD404';
  end if;
  return jsonb_build_object(
    'order', to_jsonb(o),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('type', e.type, 'detail', e.detail, 'actor', e.actor, 'created_at', e.created_at)
                       order by e.created_at)
      from public.order_events e where e.order_id = o.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.dd_api_list_orders(p_key text, p_order_number text, p_status text, p_limit int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k public.api_keys%rowtype;
begin
  k := public.dd_api_auth(p_key);
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select * from public.orders o
      where o.workspace_id = k.workspace_id
        and (p_order_number is null or o.order_number = p_order_number)
        and (p_status is null or o.status = p_status)
      order by o.created_at desc
      limit least(200, greatest(1, coalesce(p_limit, 50)))
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.dd_api_order_action(p_key text, p_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k public.api_keys%rowtype;
begin
  k := public.dd_api_auth(p_key);
  if not exists (select 1 from public.orders where id = p_id and workspace_id = k.workspace_id) then
    raise exception 'No order with that id.' using errcode = 'DD404';
  end if;
  return public.dd_apply_order_action(p_id, p_action, 'api:' || k.name);
end;
$$;

revoke all on function public.dd_api_auth(text) from public, anon, authenticated;
revoke all on function public.dd_api_create_order(text, jsonb) from public;
revoke all on function public.dd_api_get_order(text, uuid) from public;
revoke all on function public.dd_api_list_orders(text, text, text, int) from public;
revoke all on function public.dd_api_order_action(text, uuid, text) from public;
grant execute on function public.dd_api_create_order(text, jsonb) to anon, authenticated;
grant execute on function public.dd_api_get_order(text, uuid) to anon, authenticated;
grant execute on function public.dd_api_list_orders(text, text, text, int) to anon, authenticated;
grant execute on function public.dd_api_order_action(text, uuid, text) to anon, authenticated;

-- Helper functions are for signed-in users only.
revoke all on function public.dd_is_member(uuid) from public, anon;
revoke all on function public.dd_can_write(uuid) from public, anon;
revoke all on function public.dd_is_owner(uuid) from public, anon;
grant execute on function public.dd_is_member(uuid) to authenticated;
grant execute on function public.dd_can_write(uuid) to authenticated;
grant execute on function public.dd_is_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Platform console (v0.1.2)
-- Platform owners run DiceDrop itself and can see every workspace.
-- Add an owner:  insert into public.platform_admins (user_id, email)
--                select id, email from auth.users where email = 'you@example.com';
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

alter table public.workspaces
  add column if not exists status text not null default 'active'
  check (status in ('active', 'paused'));

create or replace function public.dd_is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create or replace function public.dd_platform_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.dd_is_platform_admin() then
    raise exception 'platform owners only';
  end if;

  return jsonb_build_object(
    'totals', jsonb_build_object(
      'workspaces', (select count(*) from public.workspaces),
      'users', (select count(*) from auth.users),
      'orders_total', (select count(*) from public.orders),
      'orders_24h', (select count(*) from public.orders where created_at > now() - interval '24 hours'),
      'spent_24h', coalesce((select sum(buy_cost) from public.orders where placed_at > now() - interval '24 hours'), 0),
      'open_issues', (select count(*) from public.orders where status = 'issue'),
      'buyer_accounts', (select count(*) from public.buyer_accounts),
      'boxes_online', (select count(*) from public.boxes where status = 'online' and last_heartbeat > now() - interval '5 minutes'),
      'boxes_total', (select count(*) from public.boxes)
    ),
    'workspaces', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at)
      from (
        select w.id, w.name, w.status, w.timezone, w.created_at,
          (select m.email from public.workspace_members m where m.workspace_id = w.id and m.role = 'owner' order by m.created_at limit 1) as owner_email,
          (select count(*) from public.workspace_members m where m.workspace_id = w.id) as members,
          (select count(*) from public.orders o where o.workspace_id = w.id) as orders_total,
          (select count(*) from public.orders o where o.workspace_id = w.id and o.created_at > now() - interval '24 hours') as orders_24h,
          coalesce((select sum(o.buy_cost) from public.orders o where o.workspace_id = w.id and o.placed_at > now() - interval '24 hours'), 0) as spent_24h,
          (select count(*) from public.orders o where o.workspace_id = w.id and o.status in ('pending', 'ordering')) as pending,
          (select count(*) from public.orders o where o.workspace_id = w.id and o.status = 'issue') as issues,
          (select count(*) from public.api_keys k where k.workspace_id = w.id and k.revoked_at is null) as active_keys,
          (select max(k.last_used_at) from public.api_keys k where k.workspace_id = w.id) as last_api_use,
          (select count(*) from public.buyer_accounts a where a.workspace_id = w.id) as buyer_accounts,
          (select count(*) from public.boxes b where b.workspace_id = w.id) as boxes
        from public.workspaces w
      ) x
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(to_jsonb(y) order by y.created_at)
      from (
        select u.id, u.email, u.created_at, u.last_sign_in_at,
          (u.email_confirmed_at is not null) as confirmed,
          exists (select 1 from public.platform_admins p where p.user_id = u.id) as platform_owner,
          coalesce((
            select string_agg(w.name || ' (' || m.role || ')', ', ' order by w.name)
            from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
            where m.user_id = u.id
          ), '') as workspaces
        from auth.users u
      ) y
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.dd_platform_set_workspace_status(p_workspace uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.dd_is_platform_admin() then
    raise exception 'platform owners only';
  end if;
  if p_status not in ('active', 'paused') then
    raise exception 'status must be active or paused';
  end if;
  update public.workspaces set status = p_status where id = p_workspace;
end;
$$;

-- API keys from a paused workspace are turned away.
create or replace function public.dd_api_auth(p_key text)
returns public.api_keys language plpgsql security definer set search_path = public as $$
declare
  k public.api_keys%rowtype;
begin
  if p_key is null or length(p_key) < 20 then
    raise exception 'That API key is not active.' using errcode = 'DD401';
  end if;
  select * into k from public.api_keys
    where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex') and revoked_at is null;
  if not found then
    raise exception 'That API key is not active.' using errcode = 'DD401';
  end if;
  if exists (select 1 from public.workspaces w where w.id = k.workspace_id and w.status = 'paused') then
    raise exception 'This workspace is paused.' using errcode = 'DD403';
  end if;
  update public.api_keys set last_used_at = now() where id = k.id;
  return k;
end;
$$;

revoke all on function public.dd_api_auth(text) from public, anon, authenticated;
revoke all on function public.dd_is_platform_admin() from public, anon;
revoke all on function public.dd_platform_overview() from public, anon;
revoke all on function public.dd_platform_set_workspace_status(uuid, text) from public, anon;
grant execute on function public.dd_is_platform_admin() to authenticated;
grant execute on function public.dd_platform_overview() to authenticated;
grant execute on function public.dd_platform_set_workspace_status(uuid, text) to authenticated;
