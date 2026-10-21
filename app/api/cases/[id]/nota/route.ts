import { NextResponse } from 'next/server';
import { z } from 'zod';
import { storeCasos } from '@/lib/cases/store';
import { exigirToken } from '@/lib/seguridad/token';
import {
  ErrorNotas,
  LARGO_MAXIMO_NOTA,
  borrarNota,
  estadoNotas,
  guardarNota,
  leerNota,
  limpiarTexto,
  type ConfigNotas,
} from '@/lib/notas/atomic-memory';

/**
 * /api/cases/[id]/nota — nota de revisión del analista sobre la cuenta
 * destino del caso, en Atomic Memory (opcional).
 *
 *  GET    la nota que dejó un analista en un caso anterior (o `null`)
 *  PUT    `{ texto }` guarda o corrige la nota (una por cuenta)
 *  DELETE la borra
 *
 * Es contexto para el analista, NO entra al caso: ni a la evidencia, ni a los
 * agentes, ni a la decisión. Sin configurar responde `activa: false` y el
 * monitor no la muestra.
 */

const CuerpoNota = z.object({ texto: z.string() });

type Ctx = { params: Promise<{ id: string }> };

type Preparado =
  | { respuesta: NextResponse }
  | { respuesta?: undefined; config: ConfigNotas; cuenta: string; caso: string };

async function preparar(req: Request, ctx: Ctx): Promise<Preparado> {
  // Primero el token: sin él no se revela si el caso existe ni si hay nota.
  const denegado = exigirToken(req);
  if (denegado) return { respuesta: denegado };
  const estado = estadoNotas();
  if (!estado.activa) {
    const status = req.method === 'GET' ? 200 : 409;
    return { respuesta: NextResponse.json({ activa: false, motivo: estado.motivo }, { status }) };
  }
  const { id } = await ctx.params;
  const vivo = storeCasos.get(id);
  if (!vivo) return { respuesta: NextResponse.json({ error: 'caso no encontrado' }, { status: 404 }) };
  return { config: estado.config, cuenta: vivo.caso.transaccion.destino, caso: vivo.caso.id };
}

function fallo(error: unknown, accion: string) {
  if (!(error instanceof ErrorNotas)) throw error;
  return NextResponse.json({ activa: true, error: `${accion}: ${error.message}.` }, { status: 502 });
}

export async function GET(req: Request, ctx: Ctx) {
  const p = await preparar(req, ctx);
  if (p.respuesta) return p.respuesta;
  try {
    return NextResponse.json({ activa: true, cuenta: p.cuenta, nota: await leerNota(p.config, p.cuenta) });
  } catch (error) {
    return fallo(error, 'No se pudo consultar la nota');
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const p = await preparar(req, ctx);
  if (p.respuesta) return p.respuesta;
  const cuerpo = CuerpoNota.safeParse(await req.json().catch(() => null));
  const texto = cuerpo.success ? limpiarTexto(cuerpo.data.texto) : null;
  if (!texto) {
    return NextResponse.json(
      { error: `la nota debe tener entre 1 y ${LARGO_MAXIMO_NOTA} caracteres` },
      { status: 400 },
    );
  }
  try {
    const nota = await guardarNota(p.config, { cuenta: p.cuenta, texto, caso: p.caso, ahora: new Date() });
    return NextResponse.json({ activa: true, guardada: true, nota });
  } catch (error) {
    return fallo(error, 'No se guardó la nota');
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const p = await preparar(req, ctx);
  if (p.respuesta) return p.respuesta;
  try {
    const borrada = await borrarNota(p.config, p.cuenta);
    if (!borrada) return NextResponse.json({ activa: true, error: 'no hay nota para esta cuenta' }, { status: 404 });
    return NextResponse.json({ activa: true, borrada: true });
  } catch (error) {
    return fallo(error, 'No se borró la nota');
  }
}
