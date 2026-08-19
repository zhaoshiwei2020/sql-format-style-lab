merge into style_lab.customer_snapshot as target
using style_lab.customer_increment as source
    on target.customer_id = source.customer_id
when matched and source.operation_type = 'delete' then delete
when matched then update set
    target.customer_name = source.customer_name,
    target.customer_level = source.customer_level,
    target.updated_at = source.updated_at
when not matched then insert (
    customer_id,
    customer_name,
    customer_level,
    created_at,
    updated_at
)
values (
    source.customer_id,
    source.customer_name,
    source.customer_level,
    source.created_at,
    source.updated_at
);
