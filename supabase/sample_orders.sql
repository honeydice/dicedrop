-- Optional: drops a handful of sample orders into your first workspace so the board has something to show.
-- Run AFTER you have signed in and created your workspace. Safe to run more than once.
-- To remove them later:  delete from public.orders where source = 'sample';

insert into public.orders
  (workspace_id, source, order_number, store_code, status, title, asin, buyer_name, buyer_username,
   ship_name, ship_line1, ship_city, ship_state, ship_postal,
   sale_price, sale_fees, est_cost, buy_cost, amazon_order_id, issue_reason, placed_at, shipped_at)
select w.id, 'sample', v.order_number, v.store_code, v.status, v.title, v.asin, v.buyer_name, v.buyer_username,
       v.buyer_name, v.ship_line1, v.ship_city, v.ship_state, v.ship_postal,
       v.sale_price, v.sale_fees, v.est_cost, v.buy_cost, v.amazon_order_id, v.issue_reason,
       case when v.buy_cost is not null then now() - interval '20 minutes' end,
       case when v.status = 'shipped' then now() - interval '5 minutes' end
from (select id from public.workspaces order by created_at limit 1) w
cross join (values
  ('SAMPLE-1001', 'ST01', 'pending',   'Cordless Drill/Driver Kit, 2 Batteries',      'B000000001', 'Marcus Bell',     'mbell_tools',    '100 Example St', 'Austin',     'TX', '73301', 119.99, 15.90,  84.00, null::numeric, null, null),
  ('SAMPLE-1002', 'ST02', 'pending',   'Insulated Tumbler 40 oz with Handle',         'B000000002', 'Priya Raman',     'priya.r88',      '200 Example Ave', 'Tampa',     'FL', '33601',  34.95,  4.63,  22.40, null, null, null),
  ('SAMPLE-1003', 'ST01', 'ordering',  'Cordless Leaf Blower (Tool Only)',            'B000000003', 'Dana Whitfield',  'dwhit_home',     '300 Example Rd', 'Columbus',   'OH', '43004',  89.00, 11.79,  62.00, null, null, null),
  ('SAMPLE-1004', 'ST03', 'ordered',   'Brushless Impact Driver Kit',                 'B000000004', 'Hannah Cole',     'hcole_diy',      '400 Example Ln', 'Denver',     'CO', '80014', 149.99, 19.87, 104.00, 108.40, '000-0000004-0000004', null),
  ('SAMPLE-1005', 'ST02', 'shipped',   'Oscillating Multi-Tool (Tool Only)',          'B000000005', 'Rob Castillo',    'robcast_42',     '500 Example Dr', 'Phoenix',    'AZ', '85001', 124.00, 16.43,  86.00,  89.00, '000-0000005-0000005', null),
  ('SAMPLE-1006', 'ST03', 'delivered', 'Cordless Handheld Vacuum, Rechargeable',      'B000000006', 'Evan Park',       'evanp_shop',     '600 Example Ct', 'Portland',   'OR', '97035',  59.95,  7.94,  39.99,  39.99, '000-0000006-0000006', null),
  ('SAMPLE-1007', 'ST02', 'issue',     'Ergonomic Mesh Office Chair',                 'B000000007', 'Peter Vance',     'pvance_office',  '700 Example Way', 'Raleigh',   'NC', '27513', 139.00, 18.42,  96.00, null, null, 'Item is out of stock on Amazon')
) as v(order_number, store_code, status, title, asin, buyer_name, buyer_username,
       ship_line1, ship_city, ship_state, ship_postal,
       sale_price, sale_fees, est_cost, buy_cost, amazon_order_id, issue_reason)
on conflict do nothing;
