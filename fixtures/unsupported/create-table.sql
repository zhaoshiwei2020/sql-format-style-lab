create table if not exists style_lab.order_detail (
    order_id bigint comment 'Order identifier',
    customer_id bigint comment 'Customer identifier',
    order_status string comment 'Current order status',
    amount decimal(18, 2) comment 'Gross order amount',
    items array<struct<
        sku_id: bigint,
        sku_name: string,
        quantity: int,
        sale_price: decimal(18, 2)
    >> comment 'Order line items',
    attributes map<string, string> comment 'Extensible attributes',
    created_at timestamp comment 'Creation timestamp',
    dt string comment 'Business date'
)
using parquet
partitioned by (dt)
clustered by (customer_id) into 32 buckets
location 'hdfs:///warehouse/style_lab.db/order_detail'
tblproperties (
    'parquet.compression' = 'snappy',
    'retention.days' = '365',
    'quality.owner' = 'finance-data'
);
