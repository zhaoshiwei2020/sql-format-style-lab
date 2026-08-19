CREATE TABLE `style_lab.orders_snapshot_fd`(
  `order_id` string COMMENT '订单号', 
  `user_id` string COMMENT '用户ID', 
  `amount` decimal(12,2) COMMENT '实付金额,一次分摊', 
  `tags` array<string> COMMENT '标签集合', 
  `created_time` string)
COMMENT '订单快照表'
PARTITIONED BY ( 
  `dt` string COMMENT '快照日期')
ROW FORMAT SERDE 
  'org.apache.hadoop.hive.ql.io.orc.OrcSerde' 
STORED AS INPUTFORMAT 
  'org.apache.hadoop.hive.ql.io.orc.OrcInputFormat' 
OUTPUTFORMAT 
  'org.apache.hadoop.hive.ql.io.orc.OrcOutputFormat'
LOCATION
  'hdfs://example-cluster/hive/warehouse/style_lab.db/orders_snapshot_fd'
TBLPROPERTIES (
  'orc.compress'='SNAPPY', 
  'transient_lastDdlTime'='1700000000')
