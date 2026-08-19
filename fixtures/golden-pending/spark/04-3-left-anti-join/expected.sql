select
    o.order_id,
    o.customer_id
from style_lab.fact_order as o
left anti join style_lab.blacklist_customer as b
    on o.customer_id = b.customer_id
where o.dt = '2026-08-19';
