insert overwrite table ${target_database}.order_daily_summary
partition (dt = '${hiveconf:run_date}')
select
    region_code,
    count(*) as order_count,
    sum(amount) as gross_amount,
    sum(coalesce(refund_amount, 0)) as refund_amount,
    sum(amount - coalesce(refund_amount, 0)) as net_amount
from ${source_database}.order_wide_table
where
    dt = '${hiveconf:run_date}'
    and created_at >= '${hiveconf:previous_date} 00:00:00'
    and created_at < '${hiveconf:run_date} 00:00:00'
group by region_code;
