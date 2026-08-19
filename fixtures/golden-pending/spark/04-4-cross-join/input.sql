select d.calendar_date, r.region_code from style_lab.dim_date as d cross join style_lab.dim_region as r where d.calendar_date between date '2026-08-01' and date '2026-08-31' and r.is_active = 1;
