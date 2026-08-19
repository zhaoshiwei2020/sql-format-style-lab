set spark.sql.ansi.enabled = true;
set spark.sql.shuffle.partitions = 200;
set spark.sql.adaptive.enabled = true;
set spark.sql.variable.substitute = false;
set spark.sql.path.enabled = true;
set hive.exec.dynamic.partition = true;
set hive.exec.dynamic.partition.mode = nonstrict;

set path = system_path, current_schema;

set;
set -v;
set spark.sql.ansi.enabled;

reset spark.sql.shuffle.partitions;

use style_lab;

add jar '/opt/spark/jars/example-udf.jar';
add file '/opt/spark/resources/dimension.csv';
