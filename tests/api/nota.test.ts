import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DELETE, GET, PUT } from '@/app/api/cases/[id]/nota/route';
import { GET as health } from '@/app/api/health/route';
import { evaluarAlerta, evaluarTransferencia } from '@/lib/pipeline';
import { memoria } from '@/lib/memory/store';
import { storeCasos } from '@/lib/cases/store';
import { estadoNotas, sujetoDeOperador } from '@/lib/notas/atomic-memory';
import { iniciarFixtureAtomicMemory, type FixtureAtomicMemory } from '../fixtures/atomicmemory-fixture';

/**
 * Notas de revisión del analista en Atomic Memory, contra el FIXTURE local
 * (tests/fixtures/atomicmemory-fixture.ts), no contra el servicio real.
 *
 * Lo que tiene que cumplirse: desactivada por defecto, solo el operador
 * autenticado lee o escribe, cada token ve solo sus notas, una falla del
 * proveedor nunca se informa como «guardada», y la nota jamás toca la
 * decisión, la evidencia ni la Memoria de mulas.
 */

const KEY = 'fixture-key';
const TOKEN = 'token-del-operador';
const VARS = ['ATOMICMEMORY_API_URL', 'ATOMICMEMORY_API_KEY', 'ATOMICMEMORY_TIMEOUT_MS', 'DEMO_TOKEN'] as const;
const previo = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));

let fixture: FixtureAtomicMemory;

beforeAll(async () => {
  fixture = await iniciarFixtureAtomicMemory({ apiKey: KEY });
});
afterAll(() => fixture.cerrar());

const activar = (token = TOKEN) => {
  process.env.ATOMICMEMORY_API_URL = fixture.url;
  process.env.ATOMICMEMORY_API_KEY = KEY;
  process.env.DEMO_TOKEN = token;
};

beforeEach(() => {
  storeCasos.limpiar();
  memoria.limpiar();
  fixture.filas.length = 0;
  fixture.pedidos.length = 0;
  fixture.modo = 'normal';
  for (const k of VARS) delete process.env[k];
});

afterEach(() => {
  for (const k of VARS) {
    if (previo[k] === undefined) delete process.env[k];
    else process.env[k] = previo[k];
  }
});

type Metodo = 'GET' | 'PUT' | 'DELETE';
const HANDLERS = { GET, PUT, DELETE };

async function nota(metodo: Metodo, casoId: string, opciones: { cuerpo?: unknown; token?: string | null } = {}) {
  const token = opciones.token === undefined ? process.env.DEMO_TOKEN : opciones.token;
  const r = await HANDLERS[metodo](
    new Request(`http://test/api/cases/${casoId}/nota`, {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-demo-token': token } : {}),
      },
      ...(opciones.cuerpo === undefined ? {} : { body: JSON.stringify(opciones.cuerpo) }),
    }),
    { params: Promise.resolve({ id: casoId }) },
  );
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

const alertaM01 = async () => (await evaluarAlerta('M-01', 'fan-in con reenvío rápido')).caso;
const jorgeAM01 = async () =>
  (await evaluarTransferencia({ origen: 'C-JORGE', destino: 'M-01', monto: 650, moneda: 'PEN' })).caso;

const TEXTO = 'Titular dice que es una junta vecinal; pedir sustento si vuelve a recibir fan-in.';

describe('desactivada por defecto', () => {
  it('sin configurar: GET dice activa:false, PUT no guarda y nadie llama al proveedor', async () => {
    const caso = await alertaM01();
    expect(await nota('GET', caso.id)).toEqual({ status: 200, body: { activa: false, motivo: 'Atomic Memory no está configurado' } });
    const put = await nota('PUT', caso.id, { cuerpo: { texto: TEXTO } });
    expect(put.status).toBe(409);
    expect(put.body.guardada).toBeUndefined();
    expect(fixture.pedidos).toHaveLength(0);
  });

  it('con Atomic Memory pero sin DEMO_TOKEN: no hay operador autenticado → desactivada', async () => {
    process.env.ATOMICMEMORY_API_URL = fixture.url;
    process.env.ATOMICMEMORY_API_KEY = KEY;
    const caso = await alertaM01();
    const r = await nota('GET', caso.id);
    expect(r.body).toMatchObject({ activa: false });
    expect(String(r.body.motivo)).toContain('DEMO_TOKEN');
    expect(fixture.pedidos).toHaveLength(0);
  });

  it('la key nunca viaja en claro fuera de localhost', () => {
    const env = { NODE_ENV: 'test' as const, ATOMICMEMORY_API_KEY: KEY, DEMO_TOKEN: TOKEN };
    expect(estadoNotas({ ...env, ATOMICMEMORY_API_URL: 'http://memoria.example.com' }).activa).toBe(false);
    for (const url of ['https://usuario:clave@api.atomicstrata.ai', 'https://api.atomicstrata.ai?x=1', 'https://api.atomicstrata.ai#fragmento']) {
      expect(estadoNotas({ ...env, ATOMICMEMORY_API_URL: url }).activa).toBe(false);
    }
    expect(estadoNotas({ ...env, ATOMICMEMORY_API_URL: 'https://api.atomicstrata.ai' }).activa).toBe(true);
    expect(estadoNotas({ ...env, ATOMICMEMORY_API_URL: 'http://127.0.0.1:17350' }).activa).toBe(true);
  });

  it('/api/health informa si está activa, sin revelar la key', async () => {
    activar();
    const body = (await (await health()).json()) as { modos: Record<string, unknown> };
    expect(body.modos.notas_atomic_memory).toBe(true);
    expect(JSON.stringify(body)).not.toContain(KEY);
  });
});

describe('solo el operador autenticado', () => {
  it('sin el token: 401 y no se consulta al proveedor', async () => {
    activar();
    const caso = await alertaM01();
    for (const m of ['GET', 'PUT', 'DELETE'] as const) {
      const r = await nota(m, caso.id, { token: null, cuerpo: m === 'PUT' ? { texto: TEXTO } : undefined });
      expect(r.status).toBe(401);
    }
    expect(fixture.pedidos).toHaveLength(0);
  });

  it('el sujeto sale del token, nunca del cuerpo del pedido', async () => {
    activar();
    const caso = await alertaM01();
    await nota('PUT', caso.id, { cuerpo: { texto: TEXTO, user_id: 'otro-usuario' } });
    expect(fixture.filas).toHaveLength(1);
    expect(fixture.filas[0].user_id).toBe(sujetoDeOperador(TOKEN));
    expect(fixture.pedidos.every((p) => p.user_id === sujetoDeOperador(TOKEN))).toBe(true);
  });
});

describe('guardar, recordar en el próximo caso, corregir y borrar', () => {
  it('la nota del caso de Rosa aparece cuando Jorge transfiere a la misma cuenta', async () => {
    activar();
    const alerta = await alertaM01();
    expect((await nota('GET', alerta.id)).body).toEqual({ activa: true, cuenta: 'M-01', nota: null });

    const put = await nota('PUT', alerta.id, { cuerpo: { texto: `  ${TEXTO}  ` } });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ guardada: true, nota: { cuenta: 'M-01', texto: TEXTO, caso: alerta.id } });

    const jorge = await jorgeAM01();
    const r = await nota('GET', jorge.id);
    expect(r.body).toMatchObject({ activa: true, cuenta: 'M-01', nota: { texto: TEXTO, caso: alerta.id } });

    // Otra cuenta destino no ve la nota de M-01.
    const otra = (await evaluarAlerta('M-04', 'x')).caso;
    expect((await nota('GET', otra.id)).body).toMatchObject({ cuenta: 'M-04', nota: null });

    // Se guarda verbatim, con id externo por cuenta y clase de contenido no cruda.
    expect(fixture.filas).toHaveLength(1);
    expect(fixture.filas[0].metadata).toMatchObject({ externalId: 'afs-nota-cuenta:M-01', cuenta: 'M-01', caso: alerta.id });
  });

  it('corregir reemplaza la nota en su lugar: sigue habiendo una sola', async () => {
    activar();
    const alerta = await alertaM01();
    const primera = await nota('PUT', alerta.id, { cuerpo: { texto: TEXTO } });
    const jorge = await jorgeAM01();
    const corregida = await nota('PUT', jorge.id, { cuerpo: { texto: 'Corrección: la junta no existe; tratar como mula probable.' } });
    expect(corregida.status).toBe(200);
    expect((corregida.body.nota as { id: string }).id).toBe((primera.body.nota as { id: string }).id);
    expect(fixture.filas).toHaveLength(1);
    expect((await nota('GET', alerta.id)).body).toMatchObject({
      nota: { texto: 'Corrección: la junta no existe; tratar como mula probable.', caso: jorge.id },
    });
  });

  it('borrar la quita para todos los casos de esa cuenta', async () => {
    activar();
    const alerta = await alertaM01();
    await nota('PUT', alerta.id, { cuerpo: { texto: TEXTO } });
    expect(await nota('DELETE', alerta.id)).toEqual({ status: 200, body: { activa: true, borrada: true } });
    expect(fixture.filas).toHaveLength(0);
    const jorge = await jorgeAM01();
    expect((await nota('GET', jorge.id)).body).toMatchObject({ nota: null });
    expect((await nota('DELETE', jorge.id)).status).toBe(404);
  });

  it.each([
    ['vacía', { texto: '   ' }],
    ['demasiado larga', { texto: 'x'.repeat(281) }],
    ['sin texto', {}],
    ['texto que no es string', { texto: 42 }],
  ])('nota %s → 400 y no se llama al proveedor', async (_, cuerpo) => {
    activar();
    const caso = await alertaM01();
    fixture.pedidos.length = 0;
    expect((await nota('PUT', caso.id, { cuerpo })).status).toBe(400);
    expect(fixture.pedidos).toHaveLength(0);
  });

  it('caso inexistente → 404', async () => {
    activar();
    expect((await nota('GET', 'CASO-9999')).status).toBe(404);
  });
});

describe('aislamiento', () => {
  it('otro token de operador es otro sujeto: no ve, no corrige y no borra la nota ajena', async () => {
    activar('token-A');
    const caso = await alertaM01();
    await nota('PUT', caso.id, { cuerpo: { texto: TEXTO } });

    activar('token-B');
    expect((await nota('GET', caso.id)).body).toMatchObject({ activa: true, nota: null });
    expect((await nota('DELETE', caso.id)).status).toBe(404);
    expect(fixture.filas).toHaveLength(1);

    activar('token-A');
    expect((await nota('GET', caso.id)).body).toMatchObject({ nota: { texto: TEXTO } });
  });
});

describe('fallas del proveedor: nunca un falso «guardada»', () => {
  it('error 500 → 502 y guardada ausente; la lectura también avisa', async () => {
    activar();
    const caso = await alertaM01();
    fixture.modo = 'error';
    const put = await nota('PUT', caso.id, { cuerpo: { texto: TEXTO } });
    expect(put.status).toBe(502);
    expect(put.body.guardada).toBeUndefined();
    expect(String(put.body.error)).toContain('No se guardó');
    expect((await nota('GET', caso.id)).status).toBe(502);
  });

  it('200 sin confirmar (no aparece al releer) → «no se guardó»', async () => {
    activar();
    const caso = await alertaM01();
    fixture.modo = 'no_confirma';
    const put = await nota('PUT', caso.id, { cuerpo: { texto: TEXTO } });
    expect(put.status).toBe(502);
    expect(String(put.body.error)).toContain('no confirmó');
    expect(fixture.filas).toHaveLength(0);
  });

  it('proveedor lento: corta en el tiempo configurado', async () => {
    activar();
    process.env.ATOMICMEMORY_TIMEOUT_MS = '200';
    const caso = await alertaM01();
    fixture.modo = 'lento';
    const t0 = Date.now();
    const r = await nota('GET', caso.id);
    expect(r.status).toBe(502);
    expect(String(r.body.error)).toContain('no respondió a tiempo');
    expect(Date.now() - t0).toBeLessThan(1_200);
  });

  it.each([
    ['200 con success:false', 'borrado_falso'],
    ['200 con un cuerpo no documentado', 'borrado_malformado'],
  ] as const)('DELETE %s → 502, nunca «borrada», y la nota sigue', async (_, modo) => {
    activar();
    const caso = await alertaM01();
    await nota('PUT', caso.id, { cuerpo: { texto: TEXTO } });
    fixture.modo = modo;
    const r = await nota('DELETE', caso.id);
    expect(r.status).toBe(502);
    expect(r.body.borrada).toBeUndefined();
    expect(String(r.body.error)).toContain('No se borró');
    fixture.modo = 'normal';
    expect((await nota('GET', caso.id)).body).toMatchObject({ nota: { texto: TEXTO } });
  });

  it('fila con formato inesperado → 502, no se inventa una nota ni un «guardada»', async () => {
    activar();
    const caso = await alertaM01();
    await nota('PUT', caso.id, { cuerpo: { texto: TEXTO } });
    fixture.modo = 'fila_rota';
    expect((await nota('GET', caso.id)).status).toBe(502);
    const put = await nota('PUT', caso.id, { cuerpo: { texto: 'otra' } });
    expect(put.status).toBe(502);
    expect(put.body.guardada).toBeUndefined();
  });

  it('respuesta gigante → 502 sin leerla entera', async () => {
    activar();
    const caso = await alertaM01();
    fixture.modo = 'gigante';
    const r = await nota('GET', caso.id);
    expect(r.status).toBe(502);
    expect(String(r.body.error)).toContain('demasiado grande');
  });

  it('redirección → 502: la key no sigue a otro host', async () => {
    activar();
    const caso = await alertaM01();
    fixture.modo = 'redirige';
    const r = await nota('DELETE', caso.id);
    expect(r.status).toBe(502);
    expect(fixture.pedidos.some((p) => p.ruta === '/capturado')).toBe(false);
  });

  it('key rechazada (401 del proveedor) → 502, no se filtra la key', async () => {
    activar();
    process.env.ATOMICMEMORY_API_KEY = 'key-equivocada';
    const caso = await alertaM01();
    const r = await nota('PUT', caso.id, { cuerpo: { texto: TEXTO } });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain('key-equivocada');
  });
});

describe('la nota nunca decide', () => {
  it('con o sin nota, el caso de Jorge decide igual y no cita la nota', async () => {
    const sin = await jorgeAM01();
    storeCasos.limpiar();

    activar();
    const alerta = await alertaM01();
    await nota('PUT', alerta.id, { cuerpo: { texto: TEXTO } });
    const con = await jorgeAM01();

    expect(con.decision?.accion).toBe(sin.decision?.accion);
    expect(con.decision?.regla).toBe(sin.decision?.regla);
    expect(con.ia.llamadas).toBe(sin.ia.llamadas);
    expect(JSON.stringify(con)).not.toContain('junta vecinal');
    // Una nota no es un veredicto: M-01 no entra a la Memoria de mulas.
    expect(memoria.cantidad).toBe(0);
  });
});

it('rechaza una fila que el proveedor atribuye explícitamente a otro operador', async () => {
  activar();
  const caso = await alertaM01();
  expect((await nota('PUT', caso.id, { cuerpo: { texto: TEXTO } })).status).toBe(200);
  fixture.modo = 'usuario_ajeno';
  const lectura = await nota('GET', caso.id);
  expect(lectura.status).toBe(502);
  expect(lectura.body.nota).toBeUndefined();
  const borrado = await nota('DELETE', caso.id);
  expect(borrado.status).toBe(502);
  expect(fixture.filas).toHaveLength(1);
});
