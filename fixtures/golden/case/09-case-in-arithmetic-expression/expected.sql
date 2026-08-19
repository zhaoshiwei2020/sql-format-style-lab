select
    order_id,
    round(
        cast(
            if(opening_balance is null, 0, opening_balance) as decimal(18, 2)
        )
        + cast(
            if(purchase_amount is null, 0, purchase_amount) as decimal(18, 2)
        )
        - case
            when
                cast(previous_closing_balance as decimal(18, 2)) = 0
                or substr(refund_time, 1, 7) <= previous_month
            then 0
            else cast(refund_amount as decimal(18, 2))
        end
        - cast(
            if(history_revenue is null, 0, history_revenue) as decimal(18, 2)
        ),
        2
    ) as current_period_revenue
from style_lab.complex_case_source;
