select
    order_id,
    case order_status
        when 'paid' then '01_paid'
        when 'shipped' then '02_shipped'
        when 'completed' then '03_completed'
        when 'refunded' then '04_refunded'
        else '99_other'
    end as order_status_group,
    case
        when amount >= 10000 and customer_level = 'vip' then 'high_value_vip'
        when amount >= 10000 then 'high_value'
        when amount >= 1000 then 'medium_value'
        when amount > 0 then 'low_value'
        else 'invalid'
    end as value_band,
    case
        when payment_time is null then null
        else datediff(current_date(), cast(payment_time as date))
    end as days_since_payment
from style_lab.fact_order
where
    dt between '2026-08-01' and '2026-08-19'
    and order_status in ('paid', 'shipped', 'completed')
    and amount between 100 and 100000
    and customer_id is not null
    and lower(customer_name) like '%school%'
    and region_code rlike '^(BJ|SH|GD)$'
    and not (
        is_test_order = true
        or source_system in ('sandbox', 'qa')
    );
