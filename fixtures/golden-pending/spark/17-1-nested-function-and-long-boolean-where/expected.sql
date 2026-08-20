select
    order_id,
    sha2(
        concat_ws(
            '||',
            coalesce(cast(customer_id as string), ''),
            coalesce(lower(trim(customer_name)), ''),
            coalesce(regexp_replace(phone_number, '[^0-9]', ''), ''),
            coalesce(date_format(created_at, 'yyyy-MM-dd HH:mm:ss'), '')
        ),
        256
    ) as customer_fingerprint,
    greatest(
        coalesce(course_amount, 0),
        coalesce(membership_amount, 0),
        coalesce(goods_amount, 0)
    ) as maximum_business_amount,
    element_at(
        from_json(
            raw_payload,
            'struct<order:struct<items:array<struct<sku_id:bigint,quantity:int>>>>'
        ).order.items,
        1
    ).sku_id as first_sku_id
from style_lab.order_event
where
    dt in ('2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19')
    and (
        (order_status = 'completed' and amount >= 1000)
        or (order_status = 'refunded' and refund_amount >= 500)
        or (
            order_status = 'paid'
            and payment_channel in ('wechat', 'alipay', 'bank_card')
            and risk_level not in ('high', 'blocked')
        )
    );
