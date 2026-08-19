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
