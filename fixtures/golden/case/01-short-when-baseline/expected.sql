select
    order_id,
    case
        when order_status = 'completed' then 'recognized'
        when order_status = 'refunded' then 'reversed'
        else 'pending'
    end as recognition_status
from style_lab.complex_case_source;
