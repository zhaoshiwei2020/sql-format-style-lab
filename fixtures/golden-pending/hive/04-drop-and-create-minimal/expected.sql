drop table if exists style_lab.scratch_pairs;

create table if not exists style_lab.scratch_pairs (
    `k` string,
    `v` map<string, bigint> comment '键值对'
)
stored as orc;
