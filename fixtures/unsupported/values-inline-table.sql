select
    region_code,
    region_name,
    sort_order
from values
    ('BJ', 'Beijing', 1),
    ('SH', 'Shanghai', 2),
    ('GD', 'Guangdong', 3)
as region(region_code, region_name, sort_order);
