select
    o.order_id,
    o.customer_id,
    o.amount,
    (
        select max(p.payment_time)
        from style_lab.fact_payment as p
        where p.order_id = o.order_id
    ) as latest_payment_time
from style_lab.fact_order as o
where
    o.dt = '2026-08-19'
    and exists (
        select 1
        from style_lab.fact_payment as p
        where
            p.order_id = o.order_id
            and p.payment_status = 'success'
    )
    and not exists (
        select 1
        from style_lab.fact_refund as r
        where
            r.order_id = o.order_id
            and r.refund_status = 'completed'
    );
