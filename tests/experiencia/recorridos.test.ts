import { describe, expect, it } from "vitest";
import { SALDO_INICIAL, saldosDe } from "@/lib/experiencia/cuenta";
import { CODIGO_VISIBLE, crearEstado, decisionDelMomento, reducir } from "@/lib/experiencia/estado";
import type { Estado } from "@/lib/experiencia/estado";

function ir(estado: Estado, ids: string[], codigo?: string): Estado {
  return ids.reduce((actual, id) => reducir(actual, { type: "avanzar", id, codigo }), estado);
}

describe("recorrido del viajero", () => {
  it("retiene, deja pagar el hotel y cancela al volver", () => {
    let estado = ir(crearEstado("viajero"), ["salir", "ataque"]);
    const decision = decisionDelMomento(estado);
    expect(decision?.salida).toBe("retencion_protectora");
    expect(decision?.regla).toBe("E6");
    expect(decision?.fondosSalen).toBe(false);
    expect(estado.retencion?.estado).toBe("activa");

    estado = ir(estado, ["hotel"]);
    expect(estado.hotelPagado).toBe(true);
    expect(estado.retencion?.estado).toBe("activa");
    let saldos = saldosDe(estado);
    expect(saldos.saldo).toBe(SALDO_INICIAL - 280);
    expect(saldos.enPausa).toBe(8400);
    expect(saldos.disponible).toBe(SALDO_INICIAL - 280 - 8400);

    estado = ir(estado, ["volver", "verificar"]);
    expect(decisionDelMomento(estado)?.regla).toBe("E6");
    expect(decisionDelMomento(estado)?.salida).toBe("retencion_protectora");
    estado = ir(estado, ["cancelar"]);
    expect(estado.paso).toBe("cierre");
    expect(estado.resolucion).toBe("cancelada");
    saldos = saldosDe(estado);
    expect(saldos.enPausa).toBe(0);
    expect(saldos.saldo).toBe(SALDO_INICIAL - 280);
    expect(estado.hechos.some((hecho) => /culpa|ingenua/i.test(hecho.titularDetalle))).toBe(false);
    expect(estado.hechos.map((hecho) => hecho.id)).toEqual([
      "E-01",
      "E-02",
      "E-03",
      "E-04",
      "E-05",
      "E-06",
      "E-07",
    ]);
  });

  it("libera solo después de verificar por la tablet", () => {
    let estado = ir(crearEstado("viajero"), ["salir", "ataque", "volver"]);
    const antes = reducir(estado, { type: "avanzar", id: "liberar" });
    expect(antes.paso).toBe("regreso");
    estado = ir(estado, ["verificar", "liberar"]);
    expect(estado.resolucion).toBe("liberada");
    expect(decisionDelMomento(estado)?.regla).toBe("E11");
    expect(saldosDe(estado).saldo).toBe(SALDO_INICIAL - 8400);
    expect(saldosDe(estado).enPausa).toBe(0);
  });
});

describe("recorrido de la llamada", () => {
  it("pregunta fuera del canal y no suelta el dinero si alguien guía", () => {
    let estado = ir(crearEstado("manipulado"), ["transferir"]);
    expect(estado.paso).toBe("interrupcion");
    expect(decisionDelMomento(estado)?.preguntaEstafa).toBeTruthy();
    expect(decisionDelMomento(estado)?.fondosSalen).toBe(false);
    estado = ir(estado, ["guiado"]);
    expect(decisionDelMomento(estado)?.salida).toBe("bloquear_revision");
    expect(saldosDe(estado).enPausa).toBe(4800);
    expect(saldosDe(estado).saldo).toBe(SALDO_INICIAL);
    const texto = estado.hechos.map((hecho) => hecho.titularDetalle).join(" ");
    expect(texto.toLowerCase()).not.toMatch(/culpa|ingenua|estúpida/);
  });

  it("un sí apurado tampoco mueve el dinero", () => {
    const estado = ir(crearEstado("manipulado"), ["transferir", "confirma"]);
    expect(decisionDelMomento(estado)?.fondosSalen).toBe(false);
    expect(decisionDelMomento(estado)?.salida).toBe("bloquear_revision");
  });

  it("la salida segura deja la operación en pausa", () => {
    const estado = ir(crearEstado("manipulado"), ["transferir", "salida"]);
    expect(decisionDelMomento(estado)?.salida).toBe("retencion_protectora");
    expect(estado.hechos.at(-1)?.titularTitulo).toMatch(/colgar/i);
  });
});

describe("recorrido del canal", () => {
  it("usa pasos escritos y se completa sin un tercero", () => {
    let estado = ir(crearEstado("canal"), ["simular"]);
    expect(estado.paso).toBe("escrito");
    expect(decisionDelMomento(estado)?.regla).toBe("E7");
    expect(decisionDelMomento(estado)?.canal).toBe("app_escrita");
    const mal = reducir(estado, { type: "avanzar", id: "confirmar", codigo: "0000" });
    expect(mal.paso).toBe("escrito");
    expect(mal.codigoError).toBe(true);
    estado = reducir(estado, { type: "avanzar", id: "confirmar", codigo: CODIGO_VISIBLE });
    expect(estado.paso).toBe("listo");
    expect(decisionDelMomento(estado)?.regla).toBe("E12");
    expect(decisionDelMomento(estado)?.fondosSalen).toBe(true);
    expect(saldosDe(estado).saldo).toBe(SALDO_INICIAL - 2200);
    expect(estado.hechos.at(-1)?.titularDetalle).toMatch(/Nadie más/);
  });

  it("si la voz está disponible, ofrece salir de la llamada estándar", () => {
    let estado = crearEstado("canal");
    estado = reducir(estado, { type: "voz", valor: true });
    estado = ir(estado, ["simular"]);
    expect(estado.paso).toBe("llamada_estandar");
    estado = ir(estado, ["no_puedo"]);
    expect(estado.vozDisponible).toBe(false);
    expect(estado.paso).toBe("escrito");
    expect(decisionDelMomento(estado)?.canalEvitado).toBe("llamada de voz");
  });
});
