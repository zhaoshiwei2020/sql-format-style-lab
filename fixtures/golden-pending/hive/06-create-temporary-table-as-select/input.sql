CREATE TEMPORARY TABLE style_lab.recent_orders_tmp AS SELECT order_id,user_id FROM style_lab.orders_fd WHERE dt='2026-08-19';
