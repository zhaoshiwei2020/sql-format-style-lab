alter table style_lab.order_detail
add columns (
    source_system string comment 'Source system',
    updated_at timestamp comment 'Latest update timestamp'
);
