import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

/**
 * FIXTURE — imitación local de Atomic Memory. NO es el servicio real.
 *
 * Implementa solo las cuatro rutas que usa `lib/notas/atomic-memory.ts`, con
 * la forma documentada en docs.atomicstrata.ai (API Reference):
 *
 *  POST   /v1/memories/ingest/quick        (skip_extraction + metadata.externalId)
 *  GET    /v1/memories/by-external-id/:id  ?user_id=
 *  GET    /v1/memories/:id                 ?user_id=
 *  DELETE /v1/memories/:id                 ?user_id=
 *
 * Sirve para los tests y para grabar el demo sin credenciales reales. Todo
 * vive en RAM y cada `user_id` ve solo lo suyo.
 */

export type ModoFixture =
  | 'normal'
  | 'error'
  | 'lento'
  | 'no_confirma'
  /** DELETE responde 200 `{ success: false }` y no borra. */
  | 'borrado_falso'
  /** DELETE responde 200 con un cuerpo que no es el documentado, y no borra. */
  | 'borrado_malformado'
  /** by-external-id responde 200 con una fila sin `id`/`content`. */
  | 'usuario_ajeno'
  | 'fila_rota'
  /** Responde 200 con un cuerpo de 1 MB. */
  | 'gigante'
  /** Responde 307 hacia `/capturado`, que registra el pedido (como haría otro host). */
  | 'redirige';

export interface FilaFixture {
  id: string;
  user_id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  deleted_at: null;
}

export interface FixtureAtomicMemory {
  url: string;
  filas: FilaFixture[];
  pedidos: Array<{ metodo: string; ruta: string; user_id: string | null }>;
  modo: ModoFixture;
  cerrar(): Promise<void>;
}

const responder = (res: ServerResponse, status: number, cuerpo: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
};

async function leerCuerpo(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const partes: Buffer[] = [];
  for await (const p of req) partes.push(p as Buffer);
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function iniciarFixtureAtomicMemory(opciones: { apiKey: string; puerto?: number; modo?: ModoFixture }): Promise<FixtureAtomicMemory> {
  const filas: FilaFixture[] = [];
  const pedidos: FixtureAtomicMemory['pedidos'] = [];
  const estado = { modo: opciones.modo ?? 'normal' };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    const user = url.searchParams.get('user_id');
    const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : null;
    pedidos.push({ metodo: req.method ?? '', ruta: url.pathname, user_id: user ?? (cuerpo?.user_id as string) ?? null });

    if (url.pathname === '/capturado') return responder(res, 200, { success: true });
    if (req.headers.authorization !== `Bearer ${opciones.apiKey}`) return responder(res, 401, { error: 'invalid api key' });
    if (estado.modo === 'error') return responder(res, 500, { error: 'fixture: error interno simulado' });
    if (estado.modo === 'lento') await new Promise((r) => setTimeout(r, 1_500));
    if (estado.modo === 'gigante') return responder(res, 200, { relleno: 'x'.repeat(1024 * 1024) });
    if (estado.modo === 'redirige') {
      res.writeHead(307, { location: '/capturado' });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/v1/memories/ingest/quick') {
      const b = cuerpo ?? {};
      if (typeof b.user_id !== 'string' || !b.user_id) return responder(res, 400, { error: 'user_id (string) is required' });
      if (typeof b.conversation !== 'string' || !b.conversation) return responder(res, 400, { error: 'conversation (string) is required' });
      if (typeof b.source_site !== 'string' || !b.source_site) return responder(res, 400, { error: 'source_site (string) is required' });
      if (b.content_class !== 'summary' && b.content_class !== 'redacted') {
        return responder(res, 422, { error: 'raw_content_rejected' });
      }
      const vacio = { episode_id: randomUUID(), facts_extracted: 0, memories_deleted: 0, memories_skipped: 0, links_created: 0, composites_created: 0 };
      if (estado.modo === 'no_confirma') {
        return responder(res, 200, { ...vacio, memories_stored: 0, memories_updated: 0, stored_memory_ids: [], updated_memory_ids: [] });
      }
      const metadata = (b.skip_extraction === true && b.metadata && typeof b.metadata === 'object' ? b.metadata : {}) as Record<string, unknown>;
      const previa = metadata.externalId
        ? filas.find((f) => f.user_id === b.user_id && f.metadata.externalId === metadata.externalId)
        : undefined;
      if (previa) {
        previa.content = b.conversation;
        previa.metadata = metadata;
        return responder(res, 200, { ...vacio, memories_stored: 0, memories_updated: 1, stored_memory_ids: [], updated_memory_ids: [previa.id] });
      }
      const fila: FilaFixture = {
        id: randomUUID(),
        user_id: b.user_id,
        content: b.conversation,
        metadata,
        created_at: new Date().toISOString(),
        deleted_at: null,
      };
      filas.push(fila);
      return responder(res, 200, { ...vacio, memories_stored: 1, memories_updated: 0, stored_memory_ids: [fila.id], updated_memory_ids: [] });
    }

    if (!user) return responder(res, 400, { error: 'user_id (string) is required' });
    const externo = url.pathname.match(/^\/v1\/memories\/by-external-id\/(.+)$/);
    if (req.method === 'GET' && externo) {
      const id = decodeURIComponent(externo[1]);
      const fila = filas.find((f) => f.user_id === user && f.metadata.externalId === id);
      if (fila && estado.modo === 'usuario_ajeno') return responder(res, 200, { ...fila, user_id: 'otro-operador' });
      if (fila && estado.modo === 'fila_rota') return responder(res, 200, { memory: { texto: fila.content } });
      return fila ? responder(res, 200, fila) : responder(res, 404, { error: 'Memory not found' });
    }
    const porId = url.pathname.match(/^\/v1\/memories\/([0-9a-f-]{36})$/);
    if (porId) {
      const i = filas.findIndex((f) => f.user_id === user && f.id === porId[1]);
      if (i < 0) return responder(res, 404, { error: 'Memory not found' });
      if (req.method === 'GET') return responder(res, 200, filas[i]);
      if (req.method === 'DELETE') {
        if (estado.modo === 'borrado_falso') return responder(res, 200, { success: false });
        if (estado.modo === 'borrado_malformado') return responder(res, 200, { ok: 'quizás' });
        filas.splice(i, 1);
        return responder(res, 200, { success: true });
      }
    }
    return responder(res, 404, { error: 'not found' });
  });

  await new Promise<void>((ok) => server.listen(opciones.puerto ?? 0, '127.0.0.1', ok));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    filas,
    pedidos,
    get modo() {
      return estado.modo;
    },
    set modo(m: ModoFixture) {
      estado.modo = m;
    },
    cerrar: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
