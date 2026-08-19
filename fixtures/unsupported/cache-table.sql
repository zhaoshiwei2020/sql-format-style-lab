cache lazy table recent_order as
select
    order_id,
    customer_id,
    amount,
    payment_time
from style_lab.fact_order
where dt >= date_format(date_sub(current_date(), 7), 'yyyy-MM-dd');
