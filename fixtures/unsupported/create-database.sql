create database if not exists style_lab
comment 'SQL formatting style calibration objects'
location 'hdfs:///warehouse/style_lab.db'
with dbproperties (
    'owner' = 'data-platform',
    'lifecycle' = 'temporary'
);
