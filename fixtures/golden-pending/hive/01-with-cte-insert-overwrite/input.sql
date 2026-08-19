with u as (
  select order_id,
    max(user_id) as user_id
  from
    style_lab.orders_full_fd
  where dt = '${hiveconf:yes_date}'
  group by order_id
)
insert overwrite table style_lab.order_user_fm partition (dt = '${hiveconf:month}')
select
  u.order_id, u.user_id
from u;
