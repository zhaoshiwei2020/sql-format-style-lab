select
    order_id,
    product_id,
    case
        when
            split_type = 'physical'
            and product_sequence = 1
        then round(
            apportioned_amount
            + order_adjustment
            - sum(
                if(
                    split_type in ('physical', 'gift'),
                    apportioned_amount,
                    0
                )
            ) over (
                partition by order_id
            ),
            2
        )
        when split_type = 'course' then course_amount
        else apportioned_amount
    end as balanced_amount
from style_lab.complex_case_source;
