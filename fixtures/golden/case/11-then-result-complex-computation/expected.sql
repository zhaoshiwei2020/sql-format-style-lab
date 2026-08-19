select
    order_id,
    case
        when
            return_time is null
            and planned_lesson_count = completed_lesson_count
        then round(
            apportioned_payment
            - if(
                history_revenue is null,
                0,
                cast(history_revenue as decimal(18, 2))
            ),
            2
        )
        when return_time is null then round(
            unit_revenue * current_completed_lesson_count,
            2
        )
        else round(
            cast(
                if(
                    previous_closing_balance is not null,
                    0,
                    apportioned_payment
                ) as decimal(18, 2)
            )
            - case
                when
                    cast(previous_closing_balance as decimal(18, 2)) = 0
                    or substr(return_time, 1, 7) <= previous_month
                then 0
                else apportioned_refund
            end
            + cast(
                if(
                    previous_closing_balance is null,
                    0,
                    previous_closing_balance
                ) as decimal(18, 2)
            ),
            2
        )
    end as recognized_revenue
from style_lab.complex_case_source;
