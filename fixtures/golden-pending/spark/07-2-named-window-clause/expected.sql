select
    order_id,
    customer_id,
    amount,
    row_number() over customer_window as order_sequence,
    sum(amount) over customer_window as cumulative_amount
from style_lab.fact_order
window customer_window as (
    partition by customer_id
    order by payment_time, order_id
    rows between unbounded preceding and current row
);
