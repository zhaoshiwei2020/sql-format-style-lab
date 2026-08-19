explain formatted
with customer_total as (
    select
        customer_id,
        sum(amount) as total_amount
    from style_lab.fact_order
    where dt = '2026-08-19'
    group by customer_id
)
select
    customer_id,
    total_amount
from customer_total
where total_amount >= 10000;
