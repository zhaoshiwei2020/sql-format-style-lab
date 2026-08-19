load data inpath 'hdfs:///landing/order/dt=2026-08-19'
overwrite into table style_lab.order_landing
partition (dt = '2026-08-19');
