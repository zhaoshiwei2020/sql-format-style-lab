select
    region_code,
    product_type,
    sum(amount) as total_amount
from style_lab.order_wide_table
group by cube (region_code, product_type);
