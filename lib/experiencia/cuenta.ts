import type { Estado } from "@/lib/experiencia/estado";

export const SALDO_INICIAL = 12_480;
export const PROMEDIO_90D = 650;
export const TITULAR = "Lucía Flores";
export const CUENTA_ID = "C-LUCIA";
export const NOTA_SINTETICA =
  "Datos sintéticos. Lucía Flores no es una persona real. Ninguna cifra es de un banco.";

export interface FilaCuenta {
  id: string;
  titulo: string;
  detalle: string;
  monto?: number;
  tono?: "pausa" | "ok" | "neutro";
}

export const HISTORIAL_BASE: FilaCuenta[] = [
  { id: "h1", titulo: "Hotel Sol Andino", detalle: "12 oct · pago recurrente", monto: -280 },
  { id: "h2", titulo: "Mercado Surquillo", detalle: "11 oct · compra", monto: -64 },
  { id: "h3", titulo: "Sueldo", detalle: "9 oct · abono", monto: 3200, tono: "ok" },
  { id: "h4", titulo: "Luz del Sur", detalle: "3 oct · servicio", monto: -95 },
  { id: "h5", titulo: "Hotel Sol Andino", detalle: "20 set · pago recurrente", monto: -280 },
];

export function saldosDe(estado: Estado): { saldo: number; enPausa: number; disponible: number } {
  const extra = estado.movimientosExtra.reduce((suma, movimiento) => suma + movimiento.monto, 0);
  const saldo = SALDO_INICIAL + extra;
  const enPausa = estado.retencion?.estado === "activa" ? estado.retencion.monto : 0;
  return { saldo, enPausa, disponible: saldo - enPausa };
}

export function historialDe(estado: Estado): FilaCuenta[] {
  const extras: FilaCuenta[] = [...estado.movimientosExtra].reverse().map((movimiento) => ({
    id: movimiento.id,
    titulo: movimiento.concepto,
    detalle: movimiento.cuando,
    monto: movimiento.monto,
    tono: movimiento.monto < 0 ? "neutro" : "ok",
  }));
  return [...extras, ...HISTORIAL_BASE];
}

export function beneficiariosDe(estado: Estado): FilaCuenta[] {
  const filas: FilaCuenta[] = [
    { id: "b-hotel", titulo: "Hotel Sol Andino", detalle: "Habitual · viaje", tono: "ok" },
    { id: "b-mercado", titulo: "Mercado Surquillo", detalle: "Habitual", tono: "ok" },
    { id: "b-luz", titulo: "Luz del Sur", detalle: "Habitual · servicio", tono: "ok" },
  ];
  if (estado.operacion && !estado.operacion.habitual && estado.resolucion !== "cancelada") {
    const tono = estado.resolucion === "liberada" || estado.paso === "listo" ? "neutro" : "pausa";
    filas.unshift({
      id: "b-intento",
      titulo: estado.operacion.destino,
      detalle:
        estado.retencion?.estado === "activa"
          ? "Intento · no se agregó a tu lista"
          : estado.paso === "listo"
            ? "Confirmado por ti en este recorrido"
            : "Beneficiario de esta operación",
      tono,
    });
  }
  return filas;
}

export function dispositivosDe(estado: Estado): FilaCuenta[] {
  const filas: FilaCuenta[] = [
    { id: "d-cel", titulo: "Celular de Lucía", detalle: "Conocido desde 2024", tono: "ok" },
    {
      id: "d-tablet",
      titulo: "Tablet de casa",
      detalle: "Canal alternativo · se queda en Lima",
      tono: "ok",
    },
  ];
  if (estado.dispositivoAtaque) {
    filas.push({
      id: "d-ataque",
      titulo: "Android no registrado",
      detalle: "Aparece en el intento · no sirve para confirmar",
      tono: "pausa",
    });
  }
  return filas;
}
