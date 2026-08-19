select order_id, customer_id, amount from style_lab.fact_order cluster by customer_id;
