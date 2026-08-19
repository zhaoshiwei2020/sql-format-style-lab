begin
    declare order_count bigint default 0;

    set var order_count = (
        select count(*)
        from style_lab.fact_order
        where dt = date_format(run_date, 'yyyy-MM-dd')
    );

    if order_count = 0 then
        values ('warning', 'No orders found for the run date');
    elseif order_count < 1000 then
        values ('info', 'Order volume is lower than expected');
    else
        values ('success', 'Order volume check passed');
    end if;
end;
