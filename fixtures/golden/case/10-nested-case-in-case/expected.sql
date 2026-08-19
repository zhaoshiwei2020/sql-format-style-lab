select
    order_id,
    case
        when product_type = 'course' then course_revenue
        when product_type = 'physical' then
            case
                when refund_time is not null then
                    case
                        when signed_quantity = 0 then 0
                        when signed_quantity < total_quantity then partial_revenue
                        else full_revenue
                    end
                when sign_time is not null then full_revenue
                else 0
            end
        when product_type = 'gift' then
            case
                when main_product_status = 'completed' then gift_revenue
                else 0
            end
        else 0
    end as recognized_revenue
from style_lab.complex_case_source;
