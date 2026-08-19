select
    e.order_id,
    item_position,
    item.sku_id,
    item.sku_name,
    item.quantity,
    item.sale_price
from style_lab.order_event as e
lateral view posexplode(e.items) item_view as item_position, item
where e.dt = '2026-08-19';
