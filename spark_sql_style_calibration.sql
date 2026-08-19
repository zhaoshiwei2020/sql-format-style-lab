-- Spark SQL formatting style calibration corpus
--
-- Purpose:
--   1. This is a visual style sample, not a script intended to run top to bottom.
--   2. Edit only the formatting you dislike; changing names or business logic is unnecessary.
--   3. The file intentionally repeats a few constructs in short and long forms so that a
--      formatter can infer when you prefer compact versus expanded layouts.
--   4. Some statements require Spark 4.x, a V2 table provider, or Hive compatibility.


-- ============================================================================
-- 01. Session configuration and auxiliary statements
-- ============================================================================

set spark.sql.ansi.enabled = true;
set spark.sql.shuffle.partitions = 200;
set spark.sql.adaptive.enabled = true;
set spark.sql.variable.substitute = false;
set spark.sql.path.enabled = true;
set hive.exec.dynamic.partition = true;
set hive.exec.dynamic.partition.mode = nonstrict;

set path = system_path, current_schema;

set;
set -v;
set spark.sql.ansi.enabled;

reset spark.sql.shuffle.partitions;

use style_lab;

add jar '/opt/spark/jars/example-udf.jar';
add file '/opt/spark/resources/dimension.csv';


-- ============================================================================
-- 02. Literals, identifiers, expressions, and built-in functions
-- ============================================================================

select
    1 as integer_value,
    9223372036854775807L as long_value,
    12.50BD as decimal_value,
    true as boolean_value,
    'SQL formatter' as string_value,
    date '2026-08-19' as date_value,
    timestamp '2026-08-19 09:30:00' as timestamp_value,
    interval 7 days as interval_value,
    null as null_value;

select
    order_id,
    `select` as escaped_identifier,
    amount + shipping_fee - discount_amount as payable_amount,
    round(amount * exchange_rate, 2) as converted_amount,
    cast(created_at as date) as created_date,
    try_cast(raw_amount as decimal(18, 2)) as parsed_amount,
    coalesce(customer_name, contact_name, 'unknown') as display_name,
    nullif(trim(phone_number), '') as normalized_phone,
    concat_ws(
        '-',
        cast(region_id as string),
        lpad(cast(customer_id as string), 10, '0')
    ) as customer_key,
    regexp_replace(lower(trim(email)), '\\s+', '') as normalized_email
from style_lab.fact_order;

select
    array(1, 2, 3, 5, 8) as number_array,
    map('currency', 'CNY', 'country', 'CN') as attributes,
    named_struct(
        'customer_id', customer_id,
        'customer_name', customer_name,
        'is_active', is_active
    ) as customer,
    transform(items, item -> item.sku_id) as sku_ids,
    filter(items, item -> item.quantity > 0) as valid_items,
    aggregate(
        items,
        cast(0 as decimal(18, 2)),
        (total, item) -> total + item.sale_price * item.quantity
    ) as item_amount
from style_lab.order_event;


-- ============================================================================
-- 03. CASE expressions and complex predicates
-- ============================================================================

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


-- ============================================================================
-- 04. Joins: inner, outer, semi, anti, cross, and USING
-- ============================================================================

select
    o.order_id,
    o.customer_id,
    c.customer_name,
    c.customer_level,
    p.payment_channel,
    r.refund_amount,
    coalesce(r.refund_amount, 0) as refund_amount_filled
from style_lab.fact_order as o
inner join style_lab.dim_customer as c
    on o.customer_id = c.customer_id
    and c.is_current = 1
left join style_lab.fact_payment as p
    on o.order_id = p.order_id
    and p.payment_status = 'success'
left join style_lab.fact_refund as r
    on o.order_id = r.order_id
    and r.refund_status = 'completed'
where
    o.dt = '2026-08-19'
    and o.is_test_order = false;

select
    o.order_id,
    o.customer_id
from style_lab.fact_order as o
left semi join style_lab.active_customer as c
    using (customer_id)
where o.dt = '2026-08-19';

select
    o.order_id,
    o.customer_id
from style_lab.fact_order as o
left anti join style_lab.blacklist_customer as b
    on o.customer_id = b.customer_id
where o.dt = '2026-08-19';

select
    d.calendar_date,
    r.region_code
from style_lab.dim_date as d
cross join style_lab.dim_region as r
where
    d.calendar_date between date '2026-08-01' and date '2026-08-31'
    and r.is_active = 1;


-- ============================================================================
-- 05. Common table expressions, subqueries, and EXISTS
-- ============================================================================

with paid_order as (
    select
        order_id,
        customer_id,
        amount,
        payment_time
    from style_lab.fact_order
    where
        dt = '2026-08-19'
        and order_status in ('paid', 'shipped', 'completed')
),
customer_summary as (
    select
        customer_id,
        count(*) as order_count,
        sum(amount) as total_amount,
        max(payment_time) as latest_payment_time
    from paid_order
    group by customer_id
),
ranked_customer as (
    select
        customer_id,
        order_count,
        total_amount,
        latest_payment_time,
        row_number() over (
            order by total_amount desc, customer_id
        ) as amount_rank
    from customer_summary
)
select
    customer_id,
    order_count,
    total_amount,
    latest_payment_time,
    amount_rank
from ranked_customer
where amount_rank <= 100
order by amount_rank;

select
    o.order_id,
    o.customer_id,
    o.amount,
    (
        select max(p.payment_time)
        from style_lab.fact_payment as p
        where p.order_id = o.order_id
    ) as latest_payment_time
from style_lab.fact_order as o
where
    o.dt = '2026-08-19'
    and exists (
        select 1
        from style_lab.fact_payment as p
        where
            p.order_id = o.order_id
            and p.payment_status = 'success'
    )
    and not exists (
        select 1
        from style_lab.fact_refund as r
        where
            r.order_id = o.order_id
            and r.refund_status = 'completed'
    );


-- ============================================================================
-- 06. Aggregation, GROUPING SETS, ROLLUP, CUBE, and aggregate FILTER
-- ============================================================================

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

select
    region_code,
    product_type,
    grouping_id(region_code, product_type) as grouping_level,
    sum(amount) as total_amount
from style_lab.order_wide_table
group by grouping sets (
    (),
    (region_code),
    (product_type),
    (region_code, product_type)
);

select
    region_code,
    product_type,
    sum(amount) as total_amount
from style_lab.order_wide_table
group by rollup (region_code, product_type);

select
    region_code,
    product_type,
    sum(amount) as total_amount
from style_lab.order_wide_table
group by cube (region_code, product_type);


-- ============================================================================
-- 07. Window functions, named windows, frames, and QUALIFY
-- ============================================================================

select
    order_id,
    customer_id,
    payment_time,
    amount,
    row_number() over (
        partition by customer_id
        order by payment_time desc, order_id desc
    ) as payment_sequence,
    lag(amount, 1, 0) over (
        partition by customer_id
        order by payment_time, order_id
    ) as previous_amount,
    sum(amount) over (
        partition by customer_id
        order by payment_time, order_id
        rows between unbounded preceding and current row
    ) as cumulative_amount,
    avg(amount) over (
        partition by customer_id
        order by payment_time
        rows between 6 preceding and current row
    ) as moving_average_7_orders
from style_lab.fact_order
where dt between '2026-08-01' and '2026-08-19';

select
    order_id,
    customer_id,
    amount,
    row_number() over customer_window as order_sequence,
    sum(amount) over customer_window as cumulative_amount
from style_lab.fact_order
window customer_window as (
    partition by customer_id
    order by payment_time, order_id
    rows between unbounded preceding and current row
);

select
    order_id,
    customer_id,
    amount,
    row_number() over (
        partition by customer_id
        order by payment_time desc, order_id desc
    ) as recency_rank
from style_lab.fact_order
qualify recency_rank = 1;


-- ============================================================================
-- 08. Set operators
-- ============================================================================

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

select customer_id
from style_lab.paid_customer

intersect

select customer_id
from style_lab.active_customer;

select customer_id
from style_lab.all_customer

except

select customer_id
from style_lab.blacklist_customer;


-- ============================================================================
-- 09. LATERAL VIEW, generators, table-valued functions, and sampling
-- ============================================================================

select
    e.order_id,
    item_position,
    item.sku_id,
    item.sku_name,
    item.quantity,
    item.sale_price
from style_lab.order_event as e
lateral view posexplode(e.items) item_view as item_position, item
where e.dt = '2026-08-19';

select
    order_id,
    attribute_name,
    attribute_value
from style_lab.order_event
lateral view explode(attributes) attribute_view as attribute_name, attribute_value;

select
    generated_id,
    current_timestamp() as generated_at
from range(1, 101) as generated(generated_id);

select
    order_id,
    customer_id,
    amount
from style_lab.fact_order tablesample (10 percent)
where dt = '2026-08-19';


-- ============================================================================
-- 10. PIVOT and UNPIVOT
-- ============================================================================

select
    *
from (
    select
        year(payment_time) as payment_year,
        quarter(payment_time) as payment_quarter,
        amount
    from style_lab.fact_payment
) as payment_source
pivot (
    sum(amount) as amount_sum
    for payment_quarter in (
        1 as q1,
        2 as q2,
        3 as q3,
        4 as q4
    )
) as payment_pivot
order by payment_year;

select
    payment_year,
    payment_quarter,
    amount
from style_lab.quarterly_payment
unpivot include nulls (
    amount
    for payment_quarter in (
        q1 as 'Q1',
        q2 as 'Q2',
        q3 as 'Q3',
        q4 as 'Q4'
    )
) as payment_unpivot;


-- ============================================================================
-- 11. VALUES, inline tables, sorting, distribution, and hints
-- ============================================================================

select
    region_code,
    region_name,
    sort_order
from values
    ('BJ', 'Beijing', 1),
    ('SH', 'Shanghai', 2),
    ('GD', 'Guangdong', 3)
as region(region_code, region_name, sort_order);

select /*+ broadcast(c), repartition(200, o.dt) */
    o.order_id,
    o.customer_id,
    c.customer_name
from style_lab.fact_order as o
left join style_lab.dim_customer as c
    on o.customer_id = c.customer_id
distribute by o.dt
sort by o.customer_id, o.order_id;

select
    order_id,
    customer_id,
    amount
from style_lab.fact_order
cluster by customer_id;


-- ============================================================================
-- 12. DDL: databases, tables, views, functions, and alterations
-- ============================================================================

create database if not exists style_lab
comment 'SQL formatting style calibration objects'
location 'hdfs:///warehouse/style_lab.db'
with dbproperties (
    'owner' = 'data-platform',
    'lifecycle' = 'temporary'
);

create table if not exists style_lab.order_detail (
    order_id bigint comment 'Order identifier',
    customer_id bigint comment 'Customer identifier',
    order_status string comment 'Current order status',
    amount decimal(18, 2) comment 'Gross order amount',
    items array<struct<
        sku_id: bigint,
        sku_name: string,
        quantity: int,
        sale_price: decimal(18, 2)
    >> comment 'Order line items',
    attributes map<string, string> comment 'Extensible attributes',
    created_at timestamp comment 'Creation timestamp',
    dt string comment 'Business date'
)
using parquet
partitioned by (dt)
clustered by (customer_id) into 32 buckets
location 'hdfs:///warehouse/style_lab.db/order_detail'
tblproperties (
    'parquet.compression' = 'snappy',
    'retention.days' = '365',
    'quality.owner' = 'finance-data'
);

create table style_lab.order_detail_copy
using parquet
partitioned by (dt)
as
select
    order_id,
    customer_id,
    order_status,
    amount,
    items,
    attributes,
    created_at,
    dt
from style_lab.order_detail
where dt = '2026-08-19';

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

create temporary function normalize_phone
as 'com.example.spark.udf.NormalizePhone'
using jar '/opt/spark/jars/example-udf.jar';

alter table style_lab.order_detail
add columns (
    source_system string comment 'Source system',
    updated_at timestamp comment 'Latest update timestamp'
);

alter table style_lab.order_detail
set tblproperties (
    'quality.level' = 'gold',
    'quality.updated_at' = '2026-08-19'
);

alter table style_lab.order_detail
partition (dt = '2026-08-19')
rename to partition (dt = '2026-08-18');

drop view if exists style_lab.completed_order_summary;
drop table if exists style_lab.order_detail_copy;
drop function if exists normalize_phone;


-- ============================================================================
-- 13. DML: INSERT, MERGE, UPDATE, DELETE, and LOAD
-- ============================================================================

insert into style_lab.order_status_mapping
values
    ('paid', '01_paid', true),
    ('shipped', '02_shipped', true),
    ('completed', '03_completed', true),
    ('refunded', '04_refunded', false);

insert overwrite table style_lab.order_daily_summary
partition (dt = '2026-08-19')
select
    region_code,
    product_type,
    count(*) as order_count,
    sum(amount) as total_amount
from style_lab.order_wide_table
where dt = '2026-08-19'
group by
    region_code,
    product_type;

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

merge into style_lab.customer_snapshot as target
using style_lab.customer_increment as source
    on target.customer_id = source.customer_id
when matched and source.operation_type = 'delete' then delete
when matched then update set
    target.customer_name = source.customer_name,
    target.customer_level = source.customer_level,
    target.updated_at = source.updated_at
when not matched then insert (
    customer_id,
    customer_name,
    customer_level,
    created_at,
    updated_at
)
values (
    source.customer_id,
    source.customer_name,
    source.customer_level,
    source.created_at,
    source.updated_at
);

update style_lab.customer_snapshot
set
    customer_level = 'inactive',
    updated_at = current_timestamp()
where
    last_active_date < date_sub(current_date(), 365)
    and customer_level <> 'inactive';

delete from style_lab.order_detail
where
    dt < date_format(add_months(current_date(), -24), 'yyyy-MM-dd')
    and order_status in ('cancelled', 'closed');

load data inpath 'hdfs:///landing/order/dt=2026-08-19'
overwrite into table style_lab.order_landing
partition (dt = '2026-08-19');


-- ============================================================================
-- 14. Variables and SQL scripting (Spark 4.x)
-- ============================================================================

declare or replace variable run_date date default current_date();
declare variable minimum_amount decimal(18, 2) default 100.00;

set var run_date = date '2026-08-19';
set variable minimum_amount = 500.00;

select
    order_id,
    customer_id,
    amount
from style_lab.fact_order
where
    dt = date_format(run_date, 'yyyy-MM-dd')
    and amount >= minimum_amount;

begin
    declare order_count bigint default 0;

    set var order_count = (
        select count(*)
        from style_lab.fact_order
        where dt = date_format(run_date, 'yyyy-MM-dd')
    );

    if order_count = 0 then
        values ('warning', 'No orders found for the run date');
    elseif order_count < 1000 then
        values ('info', 'Order volume is lower than expected');
    else
        values ('success', 'Order volume check passed');
    end if;
end;

drop temporary variable if exists run_date;
drop temporary variable if exists minimum_amount;


-- ============================================================================
-- 15. Metadata, maintenance, caching, and execution plans
-- ============================================================================

show databases like 'style_*';
show tables in style_lab like '*order*';
show partitions style_lab.order_detail partition (dt = '2026-08-19');

describe database extended style_lab;
describe table extended style_lab.order_detail partition (dt = '2026-08-19');
describe query
select
    customer_id,
    sum(amount) as total_amount
from style_lab.fact_order
group by customer_id;

analyze table style_lab.order_detail
compute statistics for all columns;

repair table style_lab.order_detail sync partitions;

cache lazy table recent_order as
select
    order_id,
    customer_id,
    amount,
    payment_time
from style_lab.fact_order
where dt >= date_format(date_sub(current_date(), 7), 'yyyy-MM-dd');

uncache table if exists recent_order;
clear cache;

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


-- ============================================================================
-- 16. Comments, templated variables, and ETL-style statements
-- ============================================================================

-- A single-line comment describes the expression immediately below it.
select
    order_id,
    customer_id,

    -- Gross amount before refunds.
    amount as gross_amount,

    /* Refunds are nullable because many orders have no refund record. */
    coalesce(refund_amount, 0) as refund_amount,

    amount - coalesce(refund_amount, 0) as net_amount
from style_lab.order_wide_table
where dt = '${run_date}';

set job.run_date = ${hiveconf:run_date};
set job.previous_date = ${hiveconf:previous_date};

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


-- ============================================================================
-- 17. Long expressions and deliberately difficult wrapping decisions
-- ============================================================================

select
    order_id,
    sha2(
        concat_ws(
            '||',
            coalesce(cast(customer_id as string), ''),
            coalesce(lower(trim(customer_name)), ''),
            coalesce(regexp_replace(phone_number, '[^0-9]', ''), ''),
            coalesce(date_format(created_at, 'yyyy-MM-dd HH:mm:ss'), '')
        ),
        256
    ) as customer_fingerprint,
    greatest(
        coalesce(course_amount, 0),
        coalesce(membership_amount, 0),
        coalesce(goods_amount, 0)
    ) as maximum_business_amount,
    element_at(
        from_json(
            raw_payload,
            'struct<order:struct<items:array<struct<sku_id:bigint,quantity:int>>>>'
        ).order.items,
        1
    ).sku_id as first_sku_id
from style_lab.order_event
where
    dt in (
        '2026-08-15',
        '2026-08-16',
        '2026-08-17',
        '2026-08-18',
        '2026-08-19'
    )
    and (
        (order_status = 'completed' and amount >= 1000)
        or (order_status = 'refunded' and refund_amount >= 500)
        or (
            order_status = 'paid'
            and payment_channel in ('wechat', 'alipay', 'bank_card')
            and risk_level not in ('high', 'blocked')
        )
    );


-- ============================================================================
-- 18. Hive-compatible TRANSFORM example
-- ============================================================================

select transform (
    order_id,
    raw_payload
)
using 'python3 normalize_order.py'
as (
    order_id bigint,
    normalized_payload string
)
from style_lab.order_event
where dt = '2026-08-19';
