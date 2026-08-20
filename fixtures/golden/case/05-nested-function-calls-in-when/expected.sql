select
    order_id,
    case
        when
            substr(confirm_time, 1, 10) > last_day(concat(report_month, '-01'))
            or substr(date_add(confirm_time, 729), 1, 10) < concat(report_month, '-01')
        then 0
        else datediff(
            least(
                substr(date_add(confirm_time, 729), 1, 10),
                cast(last_day(concat(report_month, '-01')) as string)
            ),
            greatest(substr(confirm_time, 1, 10), concat(report_month, '-01'))
        )
        + 1
    end as consumed_days
from style_lab.complex_case_source;
