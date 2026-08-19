from style_lab.order_wide_table
insert overwrite table style_lab.order_summary_by_region
partition (dt = '2026-08-19')
select
    region_code,
    count(*) as order_count,
    sum(amount) as total_amount
where dt = '2026-08-19'
group by region_code
insert overwrite table style_lab.order_summary_by_product
partition (dt = '2026-08-19')
select
    product_type,
    count(*) as order_count,
    sum(amount) as total_amount
where dt = '2026-08-19'
group by product_type;
