import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { crearUsuario } from '@/test/fixtures'
import { ScopeApi } from '../../../generated/prisma/enums'
import {
  DIAS_VALIDEZ_POR_DEFECTO,
  emitirToken,
  hashDeToken,
  resolverToken,
  revocarToken,
  tieneScope,
  type TokenResuelto,
} from './tokens'

async function emitirPara(
  scopes: ScopeApi[] = [ScopeApi.PRODUCTOS_READ],
  opciones: { diasValidez?: number | null } = {},
) {
  const usuario = await crearUsuario()
  const token = await emitirToken({
    usuarioId: usuario.id,
    nombre: 'prueba',
    scopes,
    ...opciones,
  })
  return { usuario, token }
}

async function resolver(claro: string): Promise<TokenResuelto | null> {
  return resolverToken(`Bearer ${claro}`)
}

describe('generación del token', () => {
  it('persiste el hash y nunca el valor en claro', async () => {
    const { token } = await emitirPara()

    const fila = await prisma.tokenApi.findUniqueOrThrow({ where: { id: token.id } })

    // El claro no está en ninguna columna de la base: lo único guardado es su hash.
    expect(fila.hash).not.toBe(token.claro)
    expect(fila.hash).toBe(hashDeToken(token.claro))
    expect(JSON.stringify(fila)).not.toContain(token.claro)
  })

  it('devuelve un prefijo visible que identifica al token sin revelarlo', async () => {
    const { token } = await emitirPara()

    expect(token.claro.startsWith('cji_')).toBe(true)
    expect(token.prefijo).toBe(token.claro.slice(0, 12))
    // Un prefijo de 12 caracteres deja 256 bits de entropía sin publicar.
    expect(token.claro.length).toBeGreaterThan(token.prefijo.length + 20)
    expect(token.claro).not.toContain(' ')
  })

  it('vence a los días por defecto y acepta no vencer', async () => {
    const { token: conVencimiento } = await emitirPara()
    const dias = Math.round(
      (conVencimiento.expiraEn!.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    )
    expect(dias).toBe(DIAS_VALIDEZ_POR_DEFECTO)

    const { token: sinVencimiento } = await emitirPara([], { diasValidez: null })
    expect(sinVencimiento.expiraEn).toBeNull()
  })
})

describe('resolución del token', () => {
  it('resuelve el token emitido al usuario dueño y sus scopes', async () => {
    const { usuario, token } = await emitirPara([ScopeApi.VENTAS_READ])

    const resuelto = await resolver(token.claro)

    expect(resuelto).not.toBeNull()
    expect(resuelto!.id).toBe(token.id)
    expect(resuelto!.usuarioId).toBe(usuario.id)
    expect(resuelto!.scopes).toEqual([ScopeApi.VENTAS_READ])
  })

  it('registra el último uso al resolverse', async () => {
    const { token } = await emitirPara()
    expect((await prisma.tokenApi.findUniqueOrThrow({ where: { id: token.id } })).ultimoUsoEn).toBeNull()

    await resolver(token.claro)

    const fila = await prisma.tokenApi.findUniqueOrThrow({ where: { id: token.id } })
    expect(fila.ultimoUsoEn).not.toBeNull()
  })

  it('rechaza un token vencido', async () => {
    const { usuario } = await emitirPara()
    const token = await emitirToken({
      usuarioId: usuario.id,
      nombre: 'vencido',
      scopes: [ScopeApi.PRODUCTOS_READ],
    })
    // Se emite válido y se lo envejece: probar con diasValidez negativo probaría
    // la emisión, no la resolución.
    await prisma.tokenApi.update({
      where: { id: token.id },
      data: { expiraEn: new Date(Date.now() - 1000) },
    })

    expect(await resolver(token.claro)).toBeNull()
  })

  it('rechaza un token revocado', async () => {
    const { token } = await emitirPara()
    await revocarToken(token.id)

    expect(await resolver(token.claro)).toBeNull()
  })

  it('revocar dos veces no mueve la fecha del primer revocado', async () => {
    const { token } = await emitirPara()
    await revocarToken(token.id)
    const primero = (await prisma.tokenApi.findUniqueOrThrow({ where: { id: token.id } })).revocadoEn

    await revocarToken(token.id)

    const segundo = (await prisma.tokenApi.findUniqueOrThrow({ where: { id: token.id } })).revocadoEn
    expect(segundo!.getTime()).toBe(primero!.getTime())
  })

  it('rechaza el token de un usuario desactivado', async () => {
    const { usuario, token } = await emitirPara()
    await prisma.usuario.update({ where: { id: usuario.id }, data: { activo: false } })

    expect(await resolver(token.claro)).toBeNull()
  })

  it('rechaza un token íntegro de otro usuario si el hash no coincide un carácter', async () => {
    const { token } = await emitirPara()
    // Cambiar el último carácter cambia el hash por completo: no hay verificación
    // parcial que pueda pasar.
    const alterado = token.claro.slice(0, -1) + (token.claro.endsWith('A') ? 'B' : 'A')

    expect(await resolver(alterado)).toBeNull()
  })
})

describe('cabeceras que no son un bearer válido', () => {
  it.each([
    ['ausente', null],
    ['vacía', ''],
    ['sin esquema', 'cji_algo'],
    ['esquema equivocado', 'Basic cji_algo'],
    ['con más espacios', 'Bearer  cji_algo'],
    ['con prefijo ajeno', 'Bearer otro_algo'],
  ])('rechaza la cabecera %s', async (_caso, cabecera) => {
    expect(await resolverToken(cabecera)).toBeNull()
  })
})

describe('scopes', () => {
  it('no alcanza con un scope distinto del pedido', async () => {
    const { token } = await emitirPara([ScopeApi.PRODUCTOS_READ])
    const resuelto = (await resolver(token.claro))!

    expect(tieneScope(resuelto, ScopeApi.PRODUCTOS_READ)).toBe(true)
    // El caso que importa: un token de lectura no puede escribir.
    expect(tieneScope(resuelto, ScopeApi.PRODUCTOS_WRITE)).toBe(false)
  })
})
