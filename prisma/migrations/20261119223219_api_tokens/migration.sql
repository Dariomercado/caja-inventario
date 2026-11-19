-- CreateEnum
CREATE TYPE "ScopeApi" AS ENUM ('PRODUCTOS_READ', 'PRODUCTOS_WRITE', 'VENTAS_READ', 'VENTAS_WRITE', 'REPORTES_READ');

-- CreateTable
CREATE TABLE "TokenApi" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "prefijo" TEXT NOT NULL,
    "scopes" "ScopeApi"[],
    "expiraEn" TIMESTAMP(3),
    "revocadoEn" TIMESTAMP(3),
    "ultimoUsoEn" TIMESTAMP(3),
    "limitePorMinuto" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,

    CONSTRAINT "TokenApi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsoTokenApi" (
    "tokenId" TEXT NOT NULL,
    "ventana" TIMESTAMP(3) NOT NULL,
    "usos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsoTokenApi_pkey" PRIMARY KEY ("tokenId","ventana")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenApi_hash_key" ON "TokenApi"("hash");

-- CreateIndex
CREATE INDEX "TokenApi_usuarioId_idx" ON "TokenApi"("usuarioId");

-- CreateIndex
CREATE INDEX "UsoTokenApi_ventana_idx" ON "UsoTokenApi"("ventana");

-- AddForeignKey
ALTER TABLE "TokenApi" ADD CONSTRAINT "TokenApi_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsoTokenApi" ADD CONSTRAINT "UsoTokenApi_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "TokenApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
