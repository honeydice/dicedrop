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
  reserved_for: string | null;
  reserved_for_name: string | null;
  orders_today: number;
  spent_today: number;
  orders_total: number;
  open_issues: number;
  current_order: string | null;
}

export interface OpsAccounts {
  accounts: OpsAccount[];
  boxes: Named[];
  clients: Named[];
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
}
