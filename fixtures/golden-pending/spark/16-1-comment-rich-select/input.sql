-- A single-line comment describes the expression immediately below it.
select
order_id,
customer_id,

-- Gross amount before refunds.
amount  as  gross_amount,

/* Refunds are nullable because many orders have no refund record. */
coalesce(refund_amount,  0)  as  refund_amount,

amount  -  coalesce(refund_amount,  0)  as  net_amount
from  style_lab.order_wide_table
where  dt  =  '${run_date}';
