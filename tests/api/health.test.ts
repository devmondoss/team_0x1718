import { describe, it, expect, afterEach } from 'vitest';
import { GET as health } from '@/app/api/health/route';

/** GET /api/health — lo que el operador revisa antes de presentar. */

const previo = process.env.DEMO_TOKEN;
afterEach(() => {
  if (previo === undefined) delete process.env.DEMO_TOKEN;
  else process.env.DEMO_TOKEN = previo;
});

describe('health', () => {
  it('mantiene los campos de antes (el frontend los lee)', async () => {
    const h = await (await health()).json();
    expect(h).toMatchObject({ ok: true, agentes: 'simulado' });
    expect(h.datos.nota).toMatch(/SINT[ÉE]TICOS/i);
  });

  it('por defecto, ningún modo opcional activo', async () => {
    delete process.env.DEMO_TOKEN;
    const h = await (await health()).json();
    expect(h.modos).toEqual({
      movimientos_en_vivo: false,
      token_operador: false,
      memoria_persistente: false,
      notas_atomic_memory: false,
    });
  });

  it('dice que hay token, pero nunca lo muestra', async () => {
    process.env.DEMO_TOKEN = 'secreto-del-operador';
    const r = await health();
    const texto = await r.text();
    expect(JSON.parse(texto).modos.token_operador).toBe(true);
    expect(texto).not.toContain('secreto-del-operador');
  });
});
