update style_lab.customer_snapshot
set
    customer_level = 'inactive',
    updated_at = current_timestamp()
where
    last_active_date < date_sub(current_date(), 365)
    and customer_level <> 'inactive';
