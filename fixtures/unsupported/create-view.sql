create or replace view style_lab.completed_order_summary (
    customer_id comment 'Customer identifier',
    order_count comment 'Completed order count',
    total_amount comment 'Completed order amount'
)
comment 'Completed order summary by customer'
as
select
    customer_id,
    count(*) as order_count,
    sum(amount) as total_amount
from style_lab.order_detail
where order_status = 'completed'
group by customer_id;
