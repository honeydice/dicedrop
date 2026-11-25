export type OrderStatus =
  | 'pending'
  | 'ordering'
  | 'ordered'
  | 'shipped'
  | 'delivered'
  | 'issue'
  | 'held'
  | 'cancelled';

export interface Named {
  id: string;
  name: string;
}

export interface OpsOrder {
  id: string;
  dd_number: string;
  auto_order_at: string | null;
  run_requested_at: string | null;
  run_kind: string | null;
  run_note: string | null;
  hidden_at: string | null;
  session_trail: { at: string; text: string }[] | null;
  session_trail_at: string | null;
  checkout: { items?: number | null; shipping?: number | null; tax?: number | null; total?: number | null; raw?: string; gift?: string; delivery_estimate?: string } | null;
  ship_name: string | null;
  ship_line1: string | null;
  ship_city: string | null;
  ship_postal: string | null;
  snapshot_at: string | null;
  status: OrderStatus;
  cancel_requested: boolean;
  source: string;
  order_number: string;
  line_id: string | null;
  store_code: string | null;
  title: string | null;
  photo_url: string | null;
  asin: string | null;
  quantity: number;
  buyer_name: string | null;
  buyer_username: string | null;
  ship_state: string | null;
  sale_price: number | null;
  sale_fees: number | null;
  est_cost: number | null;
  buy_cost: number | null;
  profit: number | null;
  amazon_order_id: string | null;
  tracking_number: string | null;
  carrier: string | null;
  issue_reason: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  placed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  client_id: string;
  client_name: string;
  account_label: string | null;
  /** Where the order is bought/fulfilled from — 'amazon', 'walmart', 'tiktok'. Shown as a marketplace tag. */
  marketplace?: string | null;
  box_name: string | null;
  stuck: boolean;
}

export interface OpsOrders {
  orders: OpsOrder[];
  total_orders: number;
  spent_today: number;
  pending_count: number;
  pending_missing_cost: number;
  pending_cogs: number;
  pending_tax: number;
  clients: Named[];
}

export interface OpsOverview {
  orders: {
    received_24h: number;
    placed_24h: number;
    pending: number;
    ordering: number;
    stuck: number;
    issues: number;
    held: number;
    awaiting_tracking: number;
    oldest_pending_minutes: number | null;
    spent_today: number;
  };
  boxes: { total: number; online: number; paused: number };
  accounts: { total: number; ready: number; attention: number; paused: number; unassigned: number };
  clients: {
    id: string;
    name: string;
    status: 'active' | 'paused';
    orders_24h: number;
    pending: number;
    issues: number;
    last_order_at: string | null;
  }[];
  issues: {
    id: string;
    order_number: string;
    title: string | null;
    issue_reason: string | null;
    updated_at: string;
    client_name: string;
    account_label: string | null;
    box_name: string | null;
  }[];
  hourly: { hour: string; received: number; placed: number }[];
}

export interface OpsKey {
  id: string;
  name: string;
  key_prefix: string;
  webhook_url: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  orders_24h: number;
}

export interface OpsClient {
  id: string;
  name: string;
  auto_order: boolean;
  status: 'active' | 'paused';
  created_at: string;
  orders_total: number;
  orders_24h: number;
  spent_today: number;
  pending: number;
  issues: number;
  last_order_at: string | null;
  keys: OpsKey[];
}

export type AccountStatus = 'warming' | 'active' | 'paused' | 'locked';
export type SessionState = 'unknown' | 'signed_in' | 'needs_sign_in' | 'verification' | 'locked';

export interface OpsAccount {
  id: string;
  label: string;
  login_email: string | null;
  status: AccountStatus;
  session_state: SessionState;
  daily_order_cap: number;
  daily_spend_cap: number | null;
  proxy_label: string | null;
  card_bank: string | null;
  card_last4: string | null;
  notes: string | null;
  last_seen_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  box_id: string | null;
  box_name: string | null;
  box_online: boolean | null;
  visibility: 'public' | 'private';
  allowed_clients: string[];
  allowed_names: string[];
  supplier: string;
  /** Account country — 'us' or 'il'. A tag, not part of the label (all Amazon accounts are AA###). */
  country?: string;
  region: string;
  billing_name: string | null;
  billing_zip: string | null;
  billing_phone: string | null;
  card_id: string | null;
  max_pending_orders: number | null;
  auto_tracking: boolean;
  order_scan: boolean;
  /** Warm-up: until this time the account only browses and gets no orders. */
  /** Amazon has the account on hold (its own words), until it is verified. No orders are sent to it. */
  /** Amazon showed this account its "are you a person" page. Warm-up and orders wait until a later visit finds Amazon normal. */
  robot_check_at?: string | null;
  /** Its Multilogin browser was open on another computer a moment ago, so the worker is leaving it alone. */
  in_use_elsewhere?: boolean;
  /** False: the account is still checked for shipping, but no new order is sent to it. */
  ordering_enabled?: boolean;
  /** Which browser the account runs in: kameleo (default) or multilogin, with the name of its Multilogin profile. */
  engine?: string;
  mlx_profile?: string | null;
  mlx_found?: boolean;
  /** Who the outgoing (proxy) address belongs to: provider and city. */
  exit_ip_info?: string | null;
  hold_reason?: string | null;
  hold_at?: string | null;
  /** The account's VPS browser opened to use by hand: starting, opening, open (with its address), closing. */
  browser_state?: string | null;
  browser_url?: string | null;
  browser_note?: string | null;
  warmup_until?: string | null;
  warmup_days?: number | null;
  warmup_last_at?: string | null;
  warmup_sessions?: number;
  warmup_next_at?: string | null;
  /** Google warmth gauge: 'clean' = Google let it search with no captcha (warm), 'captcha' = challenged (cold). */
  warm_google?: 'clean' | 'captcha' | null;
  /** Consecutive clean-Google sessions — higher = more convincingly warm / closer to graduation-ready. */
  warm_google_streak?: number;
  stage?: 'live' | 'warmup' | 'archived';
  ip_last?: { ip?: string; carrier?: string; is_mobile?: boolean; pass?: boolean; tried?: number; region?: string; city?: string } | null;
  ip_target_location?: string | null;
  ip_home_carrier?: string | null;
  ip_home_region?: string | null;
  ip_check_requested_at?: string | null;
  ip_gate_on?: boolean;
  password_set: boolean;
  awaiting_tracking: number;
  signin_requested_at: string | null;
  signin_note: string | null;
  exit_ip: string | null;
  has_profile: boolean;
  snapshot_at: string | null;
  orders_today: number;
  spent_today: number;
  orders_total: number;
  open_issues: number;
  current_order: string | null;
  totp_enabled: boolean;
  totp_set_at: string | null;
  totp_code: string | null;
}

export interface OpsAccounts {
  accounts: OpsAccount[];
  totp_expires_in: number;
  boxes: Named[];
  clients: Named[];
  cards: OpsCard[];
  ip_gate?: { enabled: boolean; before_orders: boolean; budget: number; used: number } | null;
}

export interface OpsProxy {
  id: string;
  provider: string | null;
  label: string;
  host: string;
  port: number;
  username: string | null;
  password_set: boolean;
  account_id: string | null;
  account_label: string | null;
}

export interface OpsCard {
  id: string;
  bank: string;
  last4: string;
  nickname: string | null;
  accounts: number;
}

export type BoxState = 'run' | 'pause' | 'drain';

export interface OpsBox {
  id: string;
  name: string;
  hostname: string | null;
  worker_version: string | null;
  desired_state: BoxState;
  reported_state: string | null;
  token_prefix: string | null;
  last_heartbeat: string | null;
  last_error: string | null;
  last_error_at: string | null;
  notes: string | null;
  created_at: string;
  connection: 'online' | 'offline' | 'never';
  has_token: boolean;
  provider: string;
  provider_instance_id: number | null;
  server_label: string | null;
  server_status: string | null;
  server_ip: string | null;
  server_region: string | null;
  server_cpu: number | null;
  server_ram_mb: number | null;
  server_disk_mb: number | null;
  server_product: string | null;
  server_error: string | null;
  server_synced_at: string | null;
  last_action: { type: string; actor: string; created_at: string } | null;
  placed_today: number;
  open_issues: number;
  working: { id: string; order_number: string; title: string | null; claimed_at: string; account_label: string | null; stuck: boolean }[];
  accounts: {
    id: string;
    label: string;
    status: AccountStatus;
    session_state: SessionState;
    daily_order_cap: number;
    last_seen_at: string | null;
    last_error: string | null;
    orders_today: number;
  }[];
}

export interface OpsBoxes {
  boxes: OpsBox[];
  queue: { id: string; order_number: string; title: string | null; created_at: string; ship_by: string | null; client_name: string }[];
  pending_total: number;
  contabo: { connected: boolean; last_sync_at: string | null; last_sync_error: string | null } | null;
}

export interface ContaboStatus {
  connected: boolean;
  api_user: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  instance_count: number;
  ignored: number;
}
