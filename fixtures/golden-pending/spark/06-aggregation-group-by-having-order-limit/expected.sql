select
    dt,
    region_code,
    product_type,
    count(*) as order_count,
    count(distinct customer_id) as customer_count,
    sum(amount) as gross_amount,
    sum(refund_amount) as refund_amount,
    sum(amount) filter (where order_status = 'completed') as completed_amount,
    round(avg(amount), 2) as average_order_amount,
    percentile_approx(amount, array(0.5, 0.9, 0.99)) as amount_percentiles
from style_lab.order_wide_table
where dt between '2026-08-01' and '2026-08-19'
group by
    dt,
    region_code,
    product_type
having
    count(*) >= 10
    and sum(amount) > 10000
order by
    dt,
    gross_amount desc
limit 1000;
