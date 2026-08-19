create table `style_lab.tax_start_lookup_fm` (
  `link_id` string comment '关联 ID',
  `sku_id` string comment 'SKU ID',
  `tax_start_month` string comment '首次确认月份 YYYY-MM'
) comment '计税起始月查找表(按 dt 月分区, 每月一份全量 snapshot)' partitioned by (`dt` string comment '账期 YYYY-MM') row format serde 'org.apache.hadoop.hive.ql.io.orc.OrcSerde' stored as inputformat 'org.apache.hadoop.hive.ql.io.orc.OrcInputFormat' outputformat 'org.apache.hadoop.hive.ql.io.orc.OrcOutputFormat' location 'hdfs://example-cluster/hive/warehouse/style_lab.db/tax_start_lookup_fm' tblproperties ('orc.compress' = 'SNAPPY')
;
