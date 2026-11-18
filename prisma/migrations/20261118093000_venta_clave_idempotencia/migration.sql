-- Clave de idempotencia de la venta: el mismo envío del formulario no puede
-- crear dos ventas. El índice único es la garantía; la columna es nullable
-- para las ventas ya registradas y porque Postgres admite varios NULL en un
-- índice único.

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN "claveIdempotencia" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Venta_claveIdempotencia_key" ON "Venta"("claveIdempotencia");
