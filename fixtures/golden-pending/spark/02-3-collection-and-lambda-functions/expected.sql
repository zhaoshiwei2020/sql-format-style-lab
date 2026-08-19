select
    array(1, 2, 3, 5, 8) as number_array,
    map('currency', 'CNY', 'country', 'CN') as attributes,
    named_struct(
        'customer_id', customer_id,
        'customer_name', customer_name,
        'is_active', is_active
    ) as customer,
    transform(items, item -> item.sku_id) as sku_ids,
    filter(items, item -> item.quantity > 0) as valid_items,
    aggregate(
        items,
        cast(0 as decimal(18, 2)),
        (total, item) -> total + item.sale_price * item.quantity
    ) as item_amount
from style_lab.order_event;
