with u as (
  select order_id,
    max(user_id) as user_id
  from
    bpit_fin_dwddb.dwd_fin_wx_order_fd
  where dt = '${hiveconf:yes_date}'
  group by order_id
)
insert overwrite table bpit_fin_dwddb.tgt partition (dt = '${hiveconf:month}')
select
  u.order_id, u.user_id
from u;
