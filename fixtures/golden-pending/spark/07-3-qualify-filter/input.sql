select order_id, customer_id, amount, row_number() over ( partition by customer_id order by payment_time desc, order_id desc ) as recency_rank from style_lab.fact_order qualify recency_rank = 1;
