select order_id, attribute_name, attribute_value from style_lab.order_event lateral view explode(attributes) attribute_view as attribute_name, attribute_value;
