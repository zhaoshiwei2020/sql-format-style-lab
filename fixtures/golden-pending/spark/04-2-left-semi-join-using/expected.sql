select
    o.order_id,
    o.customer_id
from style_lab.fact_order as o
left semi join style_lab.active_customer as c
    using (customer_id)
where o.dt = '2026-08-19';
