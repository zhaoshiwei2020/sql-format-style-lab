select
    order_id,
    case
        when
            (
                order_status = 'completed'
                and recognition_amount > 0
                and refund_time is null
            )
            or (
                order_status = 'refunded'
                and refund_amount > 0
                and substr(refund_time, 1, 7) = report_month
            )
            or (
                order_status = 'closed'
                and closing_balance = 0
                and coalesce(manual_adjustment, 0) <> 0
            )
        then 'needs_review'
        else 'normal'
    end as review_status
from style_lab.complex_case_source;
