import { NextResponse } from 'next/server';
import { movimientosEnVivoActivos, repo } from '@/lib/data/repo';
import { memoria } from '@/lib/memory/store';
import { modoAgentes } from '@/lib/agents';
import { estadoNotas } from '@/lib/notas/atomic-memory';

/** GET /api/health — salud del servicio (blueprint §3). */
export async function GET() {
  return NextResponse.json({
    ok: true,
    servicio: 'adaptive-financial-security',
    t: new Date().toISOString(),
    /** `claude` si hay ANTHROPIC_API_KEY real; `simulado` en caso contrario. */
    agentes: modoAgentes(),
    datos: {
      cuentas: repo.cuentas().length,
      clientes: repo.clientes().length,
      movimientos: repo.movimientos().length,
      movimientos_en_vivo: repo.movimientosEnVivo().length,
      nota: repo.notaDatos(),
    },
    /**
     * Modos activos, para revisar antes de presentar. Dice SI hay token de
     * operador, nunca cuál es.
     */
    modos: {
      movimientos_en_vivo: movimientosEnVivoActivos(),
      token_operador: Boolean(process.env.DEMO_TOKEN?.trim()),
      memoria_persistente: memoria.persistente,
      /** Notas del analista en Atomic Memory (opcional; nunca deciden). */
      notas_atomic_memory: estadoNotas().activa,
    },
    memoria: { veredictos: memoria.cantidad, carga: memoria.carga },
  });
}
