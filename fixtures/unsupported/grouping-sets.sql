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
