export type OrderStatus =
  | 'pending'
  | 'ordering'
  | 'ordered'
  | 'shipped'
  | 'delivered'
  | 'issue'
  | 'held'
  | 'cancelled';

export interface BoardOrder {
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
  placed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  account_label: string | null;
}

export interface BoardData {
  orders: BoardOrder[];
  total_orders: number;
  spent_today: number;
  spent_count: number;
  pending_count: number;
  pending_missing_cost: number;
  pending_cogs: number;
  pending_tax: number;
  tax_states: { state: string; rate: number }[];
}

export interface Workspace {
  id: string;
  name: string;
  timezone: string;
}

export type Role = 'owner' | 'staff' | 'viewer';
