select order_id, customer_id, amount from style_lab.fact_order tablesample (10 percent) where dt = '2026-08-19';
