select
    payment_year,
    payment_quarter,
    amount
from style_lab.quarterly_payment
unpivot include nulls (
    amount
    for payment_quarter in (
        q1 as 'Q1',
        q2 as 'Q2',
        q3 as 'Q3',
        q4 as 'Q4'
    )
) as payment_unpivot;
