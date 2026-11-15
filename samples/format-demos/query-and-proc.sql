-- Format with Shift+Alt+F to see SQL, SQLScript control flow, and pragma preservation
create procedure "DEMO"."PROCESS_ORDERS"(in iv_customer nvarchar(10),in iv_min_amount decimal(15,2),out ev_count integer) language sqlscript sql security invoker reads sql data as
begin
declare lv_flag integer := 0;
lt_orders = select o.order_id,o.customer_id,coalesce(sum(i.amount*i.qty),0) as total_amount,case when o.status='A' then 'Active' when o.status='P' then 'Pending' else 'Closed' end as status_label
from orders o inner join order_items i on o.order_id=i.order_id
where o.customer_id=:iv_customer and o.created_at between add_days(current_date,-90) and current_date
group by o.order_id,o.customer_id having sum(i.amount*i.qty)>=:iv_min_amount order by total_amount desc;

select count(*) into ev_count from :lt_orders;
if :ev_count>0 then lv_flag:=1; end if;

-- hanasql-format off
select    1   as   KEEP_THIS_EXACT_SPACING   from   dummy;
-- hanasql-format on
end;
