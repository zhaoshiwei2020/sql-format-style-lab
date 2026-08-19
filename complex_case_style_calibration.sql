-- 复杂 CASE WHEN 格式审美校准模板
--
-- 结构取自 fin_wx_revenue_dw/scripts/ 中的真实难例，表名、字段名和常量已泛化。
-- 本文件只用于确认格式，不用于直接执行。
--
-- 当前采用的核心规则：
--   1. 短 WHEN 保持单行。
--   2. 长 WHEN 把 when 单独放一行，所有一级布尔条件再缩进一级。
--   3. then 与 when 对齐，让“条件”和“结果”形成两个清晰区块。
--   4. and/or 放在所属条件的行首；改变优先级的括号必须显式保留。
--   5. 函数调用能清楚读完时保持紧凑，参数本身复杂时才逐层展开。
--   6. CASE 嵌入函数或算术表达式时，每进入一层语法结构增加一级缩进。


-- ============================================================================
-- 01. 基准：短条件不强制展开
-- ============================================================================

select
    order_id,
    case
        when order_status = 'completed' then 'recognized'
        when order_status = 'refunded' then 'reversed'
        else 'pending'
    end as recognition_status
from style_lab.complex_case_source;


-- ============================================================================
-- 02. 连续 AND：when 与 then 分别独占一行
-- ============================================================================

select
    order_id,
    case
        when
            special_order_id is not null
            and report_month = '2026-08'
            and apportioned_payment > 0
            and opening_balance <> 0
            and current_period_revenue = 0
        then opening_balance
        when
            special_order_id is not null
            and report_month = '2026-08'
            and apportioned_payment > 0
            and actual_balance <> 0
            and sign_time is not null
        then actual_balance
        else current_period_revenue
    end as adjusted_revenue
from style_lab.complex_case_source;


-- ============================================================================
-- 03. AND 中嵌套 OR：括号表达式作为一个完整的一级条件
-- ============================================================================

select
    order_id,
    case
        when
            special_order_id is not null
            and report_month = '2026-08'
            and expected_balance <> 0
            and (
                sign_time is null
                or (
                    sign_time is not null
                    and actual_balance = 0
                )
            )
        then 0
        when
            special_order_id is not null
            and report_month = '2026-08'
            and expected_balance <> 0
            and sign_time is not null
            and actual_balance <> 0
        then actual_balance
        else current_period_revenue
    end as adjusted_revenue
from style_lab.complex_case_source;


-- ============================================================================
-- 04. 多组 AND/OR：通过括号直接展示布尔优先级
-- ============================================================================

select
    order_id,
    case
        when
            (
                order_status = 'completed'
                and recognition_amount > 0
                and refund_time is null
            )
            or (
                order_status = 'refunded'
                and refund_amount > 0
                and substr(refund_time, 1, 7) = report_month
            )
            or (
                order_status = 'closed'
                and closing_balance = 0
                and coalesce(manual_adjustment, 0) <> 0
            )
        then 'needs_review'
        else 'normal'
    end as review_status
from style_lab.complex_case_source;


-- ============================================================================
-- 05. WHEN 内包含较深函数调用
-- ============================================================================

select
    order_id,
    case
        when
            substr(confirm_time, 1, 10) > last_day(
                concat(report_month, '-01')
            )
            or substr(date_add(confirm_time, 729), 1, 10) < concat(
                report_month,
                '-01'
            )
        then 0
        else datediff(
            least(
                substr(date_add(confirm_time, 729), 1, 10),
                cast(last_day(concat(report_month, '-01')) as string)
            ),
            greatest(
                substr(confirm_time, 1, 10),
                concat(report_month, '-01')
            )
        ) + 1
    end as consumed_days
from style_lab.complex_case_source;


-- ============================================================================
-- 06. WHEN 内包含窗口函数和条件函数
-- ============================================================================

select
    order_id,
    case
        when
            count(
                if(product_name like '%device%', 1, null)
            ) over (
                partition by order_id
            ) = 1
            and coalesce(product_amount, 0) > 0
        then product_amount
        when
            count(
                if(product_name like '%device%', 1, null)
            ) over (
                partition by order_id
            ) > 1
            and coalesce(product_amount, 0) > 0
        then apportioned_product_amount
        else 0
    end as recognized_product_amount
from style_lab.complex_case_source;


-- ============================================================================
-- 07. THEN 内包含窗口聚合和多层函数
-- ============================================================================

select
    order_id,
    product_id,
    case
        when
            split_type = 'physical'
            and product_sequence = 1
        then round(
            apportioned_amount
            + order_adjustment
            - sum(
                if(
                    split_type in ('physical', 'gift'),
                    apportioned_amount,
                    0
                )
            ) over (
                partition by order_id
            ),
            2
        )
        when split_type = 'course' then course_amount
        else apportioned_amount
    end as balanced_amount
from style_lab.complex_case_source;


-- ============================================================================
-- 08. CASE 嵌在 round/cast 中
-- ============================================================================

select
    order_id,
    cast(
        round(
            case
                when tax_start_month = report_month then (
                    opening_balance
                    + opening_adjustment
                    + purchase_amount
                    - refund_amount
                    + material_fee
                ) * coalesce(tax_rate, 0) / (
                    1 + coalesce(tax_rate, 0)
                )
                when tax_start_month < report_month then (
                    opening_adjustment
                    + purchase_amount
                    - refund_amount
                    + material_fee
                ) * coalesce(tax_rate, 0) / (
                    1 + coalesce(tax_rate, 0)
                )
                else 0
            end,
            5
        ) as decimal(38, 5)
    ) as tax_payable
from style_lab.complex_case_source;


-- ============================================================================
-- 09. CASE 作为长算术表达式的一部分
-- ============================================================================

select
    order_id,
    round(
        cast(
            if(opening_balance is null, 0, opening_balance) as decimal(18, 2)
        )
        + cast(
            if(purchase_amount is null, 0, purchase_amount) as decimal(18, 2)
        )
        - case
            when
                cast(previous_closing_balance as decimal(18, 2)) = 0
                or substr(refund_time, 1, 7) <= previous_month
            then 0
            else cast(refund_amount as decimal(18, 2))
        end
        - cast(
            if(history_revenue is null, 0, history_revenue) as decimal(18, 2)
        ),
        2
    ) as current_period_revenue
from style_lab.complex_case_source;


-- ============================================================================
-- 10. CASE 套 CASE
-- ============================================================================

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


-- ============================================================================
-- 11. CASE 的 THEN 结果本身也是复杂条件计算
-- ============================================================================

select
    order_id,
    case
        when
            return_time is null
            and planned_lesson_count = completed_lesson_count
        then round(
            apportioned_payment
            - if(
                history_revenue is null,
                0,
                cast(history_revenue as decimal(18, 2))
            ),
            2
        )
        when return_time is null then round(
            unit_revenue * current_completed_lesson_count,
            2
        )
        else round(
            cast(
                if(previous_closing_balance is not null, 0, apportioned_payment) as decimal(18, 2)
            )
            - case
                when
                    cast(previous_closing_balance as decimal(18, 2)) = 0
                    or substr(return_time, 1, 7) <= previous_month
                then 0
                else apportioned_refund
            end
            + cast(
                if(previous_closing_balance is null, 0, previous_closing_balance) as decimal(18, 2)
            ),
            2
        )
    end as recognized_revenue
from style_lab.complex_case_source;


-- ============================================================================
-- 12. 聚合函数中的复杂 CASE
-- ============================================================================

select
    report_month,
    sum(
        case
            when
                source_order_id is not null
                and target_order_id is not null
                and (
                    coalesce(source_customer_id, '__NULL__')
                        <> coalesce(target_customer_id, '__NULL__')
                    or coalesce(source_status, -999999)
                        <> coalesce(target_status, -999999)
                    or coalesce(source_created_time, '__NULL__')
                        <> coalesce(target_created_time, '__NULL__')
                    or coalesce(source_amount, 0)
                        <> coalesce(target_amount, 0)
                )
            then 1
            else 0
        end
    ) as mismatch_count,
    max(
        case
            when
                tax_status <> 'not_started'
                and abs(
                    contract_liability_closing
                    - closing_balance / (1 + tax_rate)
                ) > 0.01
            then abs(
                contract_liability_closing
                - closing_balance / (1 + tax_rate)
            )
            else 0
        end
    ) as maximum_difference
from style_lab.complex_case_source
group by report_month;


-- ============================================================================
-- 13. 极端综合场景：长条件 + 嵌套函数 + 嵌套 CASE + 窗口聚合
-- ============================================================================

select
    order_id,
    product_id,
    case
        when
            coalesce(source_system, '') in ('order', 'refund', 'adjustment')
            and substr(event_time, 1, 10) between
                concat(report_month, '-01')
                and cast(last_day(concat(report_month, '-01')) as string)
            and (
                event_status = 'completed'
                or (
                    event_status = 'refunded'
                    and coalesce(refund_amount, 0) > 0
                )
                or (
                    event_status = 'adjusted'
                    and abs(coalesce(adjustment_amount, 0)) > 0.01
                )
            )
            and count(
                if(event_status in ('completed', 'refunded'), 1, null)
            ) over (
                partition by order_id, product_id
            ) >= 1
        then round(
            coalesce(opening_balance, 0)
            + coalesce(purchase_amount, 0)
            - coalesce(refund_amount, 0)
            + case
                when product_type = 'course' then lesson_revenue
                when product_type = 'physical' then
                    case
                        when sign_time is not null then physical_revenue
                        else 0
                    end
                else coalesce(manual_adjustment, 0)
            end
            - sum(
                coalesce(history_revenue, 0)
            ) over (
                partition by order_id
            ),
            2
        )
        else 0
    end as final_revenue
from style_lab.complex_case_source;
