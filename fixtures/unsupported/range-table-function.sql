select
    generated_id,
    current_timestamp() as generated_at
from range(1, 101) as generated(generated_id);
