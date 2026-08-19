select transform (
    order_id,
    raw_payload
)
using 'python3 normalize_order.py'
as (
    order_id bigint,
    normalized_payload string
)
from style_lab.order_event
where dt = '2026-08-19';
