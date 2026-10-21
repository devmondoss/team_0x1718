import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Notas de revisión del analista, guardadas en Atomic Memory.
 *
 * Una nota es contexto para el PRÓXIMO analista que vea la misma cuenta
 * destino («el titular dijo que es una junta; pedir sustento si vuelve a
 * recibir fan-in»). No es un veredicto, no es evidencia y no entra al
 * pipeline: la decisión sobre el dinero sigue siendo del Policy Engine y la
 * Memoria de mulas (`lib/memory/store.ts`) sigue siendo la única fuente de P1.
 *
 * Opcional y solo del servidor: sin `ATOMICMEMORY_API_URL`,
 * `ATOMICMEMORY_API_KEY` y `DEMO_TOKEN` queda desactivada y nada cambia.
 *
 * Identidad: el sujeto de Atomic Memory (`user_id`) se deriva del token del
 * operador, que ya autentica la consola. Nunca viene del pedido, ni del
 * navegador, ni de un `session_id` compartido (en Cloud v1 el thread
 * reemplazaría al sujeto). Otro token → otro sujeto → otras notas.
 *
 * Contrato HTTP (docs.atomicstrata.ai, API Reference):
 *  - POST   /v1/memories/ingest/quick   con skip_extraction=true (verbatim) y
 *           metadata.externalId: re-ingerir el mismo id corrige la nota en su
 *           lugar en vez de duplicarla.
 *  - GET    /v1/memories/by-external-id/{externalId}?user_id=
 *  - DELETE /v1/memories/{id}?user_id=
 */

export const LARGO_MAXIMO_NOTA = 280;
const TIMEOUT_POR_DEFECTO_MS = 2_500;
const FUENTE = 'adaptive-financial-security';
const PREFIJO = (cuenta: string) => `Nota revisada del analista sobre la cuenta ${cuenta}: `;

export interface Nota {
  id: string;
  cuenta: string;
  texto: string;
  /** Caso desde el que se escribió o corrigió por última vez. */
  caso: string | null;
  revisada_en: string | null;
}

export interface ConfigNotas {
  apiUrl: string;
  apiKey: string;
  /** `user_id` de Atomic Memory: derivado del token del operador, nunca del pedido. */
  sujeto: string;
  timeoutMs: number;
}

export type EstadoNotas = { activa: true; config: ConfigNotas } | { activa: false; motivo: string };

/** Falla del proveedor: la nota NO se guardó, leyó o borró. */
export class ErrorNotas extends Error {}

const esLoopback = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '[::1]';

export function sujetoDeOperador(token: string): string {
  const huella = createHash('sha256').update(`${FUENTE}:notas-analista:${token}`).digest('hex');
  return `afs-operador-${huella.slice(0, 32)}`;
}

export function estadoNotas(env: NodeJS.ProcessEnv = process.env): EstadoNotas {
  const apiUrl = env.ATOMICMEMORY_API_URL?.trim().replace(/\/+$/, '');
  const apiKey = env.ATOMICMEMORY_API_KEY?.trim();
  const token = env.DEMO_TOKEN?.trim();
  if (!apiUrl || !apiKey) return { activa: false, motivo: 'Atomic Memory no está configurado' };
  // Sin token no hay un operador autenticado al que atribuir las notas.
  if (!token) return { activa: false, motivo: 'las notas exigen el token del operador (DEMO_TOKEN)' };

  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return { activa: false, motivo: 'ATOMICMEMORY_API_URL no es una URL válida' };
  }
  if (url.username || url.password || url.search || url.hash) {
    return { activa: false, motivo: 'ATOMICMEMORY_API_URL debe ser una URL sin credenciales, consulta ni fragmento' };
  }
  // La key viaja como Bearer: en claro solo hacia la misma máquina.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && esLoopback(url.hostname))) {
    return { activa: false, motivo: 'ATOMICMEMORY_API_URL debe ser https (o http solo en localhost)' };
  }

  const pedido = Number(env.ATOMICMEMORY_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(pedido) && pedido > 0 ? Math.min(Math.max(pedido, 100), 10_000) : TIMEOUT_POR_DEFECTO_MS;
  return { activa: true, config: { apiUrl, apiKey, sujeto: sujetoDeOperador(token), timeoutMs } };
}

/** Un id externo por cuenta y sujeto: así corregir reemplaza en vez de duplicar. */
const idExterno = (cuenta: string) => `afs-nota-cuenta:${cuenta}`;

/** Una fila de memoria trae su embedding: 256 KB sobran y acotan una respuesta rota. */
const MAXIMO_RESPUESTA_BYTES = 256 * 1024;

/** Lee el cuerpo hasta el tope; el mismo `signal` del timeout corta también la lectura. */
async function leerCuerpo(res: Response): Promise<unknown> {
  if (!res.body) return null;
  const lector = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAXIMO_RESPUESTA_BYTES) {
      await lector.cancel();
      throw new ErrorNotas('Atomic Memory devolvió una respuesta demasiado grande');
    }
    partes.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    return null;
  }
}

const esCorte = (error: unknown) =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

async function llamar(config: ConfigNotas, ruta: string, init: RequestInit = {}): Promise<{ status: number; cuerpo: unknown }> {
  try {
    const res = await fetch(`${config.apiUrl}${ruta}`, {
      ...init,
      cache: 'no-store',
      // Una redirección podría llevarse la key a otro host: se rechaza.
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    const cuerpo = await leerCuerpo(res);
    if (res.status === 404) return { status: 404, cuerpo };
    if (!res.ok) throw new ErrorNotas(`Atomic Memory respondió ${res.status}`);
    return { status: res.status, cuerpo };
  } catch (error) {
    if (error instanceof ErrorNotas) throw error;
    throw new ErrorNotas(esCorte(error) ? 'Atomic Memory no respondió a tiempo' : 'no se pudo conectar con Atomic Memory');
  }
}

/**
 * Fila de `GET /v1/memories/by-external-id/:externalId` (la misma de
 * `GET /v1/memories/:id`). Solo se valida lo que se usa; el resto se ignora.
 */
const FilaMemoria = z.object({
  id: z.string().min(1),
  user_id: z.string().optional(),
  content: z.string(),
  created_at: z.string().optional(),
  deleted_at: z.string().nullish(),
  metadata: z
    .object({
      externalId: z.string(),
      caso: z.string().optional(),
      revisada_en: z.string().optional(),
    })
    .passthrough(),
});

const RespuestaBorrado = z.object({ success: z.literal(true) });

function aNota(cuenta: string, cuerpo: unknown, sujeto: string): Nota | null {
  const fila = FilaMemoria.safeParse(cuerpo);
  if (!fila.success) throw new ErrorNotas('Atomic Memory devolvió una nota con formato inesperado');
  const { id, user_id, content, created_at, deleted_at, metadata } = fila.data;
  if (user_id !== undefined && user_id !== sujeto) throw new ErrorNotas('Atomic Memory devolvió una nota de otro operador');
  // Solo es nuestra nota si el id externo coincide: nunca mostrar otra memoria del sujeto.
  if (deleted_at || metadata.externalId !== idExterno(cuenta)) return null;
  const prefijo = PREFIJO(cuenta);
  return {
    id,
    cuenta,
    texto: content.startsWith(prefijo) ? content.slice(prefijo.length) : content,
    caso: metadata.caso ?? null,
    revisada_en: metadata.revisada_en ?? created_at ?? null,
  };
}

export async function leerNota(config: ConfigNotas, cuenta: string): Promise<Nota | null> {
  const q = new URLSearchParams({ user_id: config.sujeto });
  const { status, cuerpo } = await llamar(config, `/v1/memories/by-external-id/${encodeURIComponent(idExterno(cuenta))}?${q}`);
  return status === 404 ? null : aNota(cuenta, cuerpo, config.sujeto);
}

/** Normaliza el texto del analista; `null` si no es una nota válida. */
export function limpiarTexto(v: string): string | null {
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > 0 && t.length <= LARGO_MAXIMO_NOTA ? t : null;
}

/**
 * Guarda (o corrige) la nota de la cuenta. Solo devuelve la nota si Atomic
 * Memory la devuelve al releerla con el mismo texto: un 200 sin ids, o una
 * lectura distinta, es «no se guardó», nunca «guardada».
 */
export async function guardarNota(
  config: ConfigNotas,
  datos: { cuenta: string; texto: string; caso: string; ahora: Date },
): Promise<Nota> {
  const { status } = await llamar(config, '/v1/memories/ingest/quick', {
    method: 'POST',
    body: JSON.stringify({
      user_id: config.sujeto,
      conversation: PREFIJO(datos.cuenta) + datos.texto,
      source_site: FUENTE,
      skip_extraction: true,
      content_class: 'summary',
      metadata: {
        externalId: idExterno(datos.cuenta),
        cuenta: datos.cuenta,
        caso: datos.caso,
        revisada_en: datos.ahora.toISOString(),
      },
    }),
  });
  if (status === 404) throw new ErrorNotas('Atomic Memory respondió 404');
  const nota = await leerNota(config, datos.cuenta);
  if (!nota || nota.texto !== datos.texto) throw new ErrorNotas('Atomic Memory no confirmó la nota');
  return nota;
}

/**
 * `true` si había una nota y se borró; `false` si no había ninguna. Solo es
 * «borrada» si Core responde `{ success: true }` y la nota ya no aparece al
 * releerla.
 */
export async function borrarNota(config: ConfigNotas, cuenta: string): Promise<boolean> {
  const nota = await leerNota(config, cuenta);
  if (!nota) return false;
  const q = new URLSearchParams({ user_id: config.sujeto });
  const { status, cuerpo } = await llamar(config, `/v1/memories/${encodeURIComponent(nota.id)}?${q}`, { method: 'DELETE' });
  if (status === 404) return false;
  if (!RespuestaBorrado.safeParse(cuerpo).success) throw new ErrorNotas('Atomic Memory no confirmó el borrado');
  if (await leerNota(config, cuenta)) throw new ErrorNotas('la nota sigue en Atomic Memory');
  return true;
}
