select customer_id
from style_lab.all_customer

except

select customer_id
from style_lab.blacklist_customer;
