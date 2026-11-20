-- Contador diario de llamadas al modelo del asistente.
--
-- Una fila por día UTC y el contador como valor entero: el incremento es un
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING, así que la base serializa y dos
-- instancias del servidor no pueden contar de menos.

CREATE TABLE "UsoModeloDiario" (
    "fecha" DATE NOT NULL,
    "llamadas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsoModeloDiario_pkey" PRIMARY KEY ("fecha")
);
