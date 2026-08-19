select
    order_id,
    case
        when
            count(
                if(product_name like '%device%', 1, null)
            ) over (
                partition by order_id
            ) = 1
            and coalesce(product_amount, 0) > 0
        then product_amount
        when
            count(
                if(product_name like '%device%', 1, null)
            ) over (
                partition by order_id
            ) > 1
            and coalesce(product_amount, 0) > 0
        then apportioned_product_amount
        else 0
    end as recognized_product_amount
from style_lab.complex_case_source;
