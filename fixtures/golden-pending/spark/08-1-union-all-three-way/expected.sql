select
    customer_id,
    'course' as business_type
from style_lab.course_customer
where dt = '2026-08-19'

union all

select
    customer_id,
    'membership' as business_type
from style_lab.membership_customer
where dt = '2026-08-19'

union all

select
    customer_id,
    'goods' as business_type
from style_lab.goods_customer
where dt = '2026-08-19';
