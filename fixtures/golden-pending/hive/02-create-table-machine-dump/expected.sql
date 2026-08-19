create table `style_lab.orders_snapshot_fd` (
    `order_id` string comment '订单号',
    `user_id` string comment '用户ID',
    `amount` decimal(12, 2) comment '实付金额,一次分摊',
    `tags` array<string> comment '标签集合',
    `created_time` string
) comment '订单快照表'
partitioned by (`dt` string comment '快照日期')
row format serde 'org.apache.hadoop.hive.ql.io.orc.OrcSerde'
stored as inputformat 'org.apache.hadoop.hive.ql.io.orc.OrcInputFormat'
outputformat 'org.apache.hadoop.hive.ql.io.orc.OrcOutputFormat'
location 'hdfs://example-cluster/hive/warehouse/style_lab.db/orders_snapshot_fd'
tblproperties ('orc.compress' = 'SNAPPY', 'transient_lastDdlTime' = '1700000000')
