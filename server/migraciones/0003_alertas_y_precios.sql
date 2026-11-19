-- Alerta de stock bajo por producto y precio unitario en cada movimiento
-- (precio de venta en salidas, costo de compra en entradas) para el panel.
alter table productos add column stock_minimo integer not null default 2 check (stock_minimo between 0 and 1000000);
alter table movimientos add column precio_unitario numeric(12,2) check (precio_unitario >= 0);
