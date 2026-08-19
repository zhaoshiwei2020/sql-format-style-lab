# Formatter vs 人工语料分歧报告

生成时间基准：本地运行 | 逐字一致 38 | 有分歧 4 | 无输出/崩溃 0

分歧不一定是 bug：语料本身存在内部不一致（见 ARCHITECTURE.md §26.4）。每一处分歧都是一道校准 A/B 题。

## fixtures/golden/case/05-nested-function-calls-in-when

(-) 人工语料 | (+) formatter 输出

```diff
                  substr(date_add(confirm_time, 729), 1, 10),
                  cast(last_day(concat(report_month, '-01')) as string)
              ),
-             greatest(
+             greatest(substr(confirm_time, 1, 10), concat(report_month, '-01'))
-                 substr(confirm_time, 1, 10),
+         )
-                 concat(report_month, '-01')
+         + 1
-             )
+     end as consumed_days
-         ) + 1
+ from style_lab.complex_case_source;
-     end as consumed_days
+ 
- from style_lab.complex_case_source;
- 
```

## fixtures/golden/case/07-window-aggregate-in-then

(-) 人工语料 | (+) formatter 输出

```diff
              apportioned_amount
              + order_adjustment
              - sum(
-                 if(
+                 if(split_type in ('physical', 'gift'), apportioned_amount, 0)
-                     split_type in ('physical', 'gift'),
+             ) over (
-                     apportioned_amount,
+                 partition by order_id
-                     0
+             ),
-                 )
+             2
-             ) over (
+         )
-                 partition by order_id
+         when split_type = 'course' then course_amount
-             ),
+         else apportioned_amount
```

## fixtures/golden/case/11-then-result-complex-computation

(-) 人工语料 | (+) formatter 输出

```diff
          )
          else round(
              cast(
-                 if(previous_closing_balance is not null, 0, apportioned_payment) as decimal(18, 2)
+                 if(
-             )
+                     previous_closing_balance is not null,
-             - case
+                     0,
-                 when
+                     apportioned_payment
-                     cast(previous_closing_balance as decimal(18, 2)) = 0
+                 ) as decimal(18, 2)
-                     or substr(return_time, 1, 7) <= previous_month
+             )
-                 then 0
+             - case
-                 else apportioned_refund
+                 when
```

## fixtures/golden-pending/spark/17-1-nested-function-and-long-boolean-where

(-) 人工语料 | (+) formatter 输出

```diff
          '2026-08-19'
      )
      and (
-         (order_status = 'completed' and amount >= 1000)
+         (
-         or (order_status = 'refunded' and refund_amount >= 500)
+             order_status = 'completed'
-         or (
+             and amount >= 1000
-             order_status = 'paid'
+         )
-             and payment_channel in ('wechat', 'alipay', 'bank_card')
+         or (
-             and risk_level not in ('high', 'blocked')
+             order_status = 'refunded'
-         )
+             and refund_amount >= 500
-     );
+         )
```
