delete from style_lab.order_detail
where
    dt < date_format(add_months(current_date(), -24), 'yyyy-MM-dd')
    and order_status in ('cancelled', 'closed');
