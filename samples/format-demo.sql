create procedure "DEMO"."GET_ORDERS"(in iv_customer nvarchar(10), out ev_count integer) language sqlscript sql security invoker reads sql data as
begin
declare lv_total decimal(15,2) = 0;
lt = select o.order_id,o.customer_id,sum(i.amount*i.qty) as amount,case when o.status='A' then 'Active' else 'Other' end as status_text
from orders o inner join order_items i on o.order_id=i.order_id
where o.customer_id=:iv_customer and o.created_at between add_days(current_date,-30) and current_date
group by o.order_id,o.customer_id order by amount desc;
select count(*) into ev_count from :lt;
if :ev_count>0 then lv_total=:lv_total+1; end if;
end
