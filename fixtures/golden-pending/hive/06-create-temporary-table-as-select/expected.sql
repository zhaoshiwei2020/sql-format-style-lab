create temporary table style_lab.recent_orders_tmp as
select
    order_id,
    user_id
from style_lab.orders_fd
where dt = '2026-08-19';
