import { describe, expect, it } from "vitest";
import { decidir, nivelDe, PUNTOS_OPERACION } from "@/lib/experiencia/motor";
import type { EntradaMotor, EventoRiesgo, ModoUsuario } from "@/lib/experiencia/tipos";

const base: EntradaMotor = {
  modo: "disponible",
  eventos: [],
  monto: 200,
  beneficiarioHabitual: false,
  politicaViajeActiva: true,
  umbralViaje: 500,
  vozDisponible: true,
  canalAlternativo: "segundo_dispositivo",
  respuestaEstafa: null,
  verificadoEnCanalSeguro: false,
  liberacionExplicita: false,
  permitirHabituales: true,
  hayOtraRetencion: false,
};

describe("motor de la experiencia", () => {
  it("es determinista", () => {
    const entrada: EntradaMotor = {
      ...base,
      modo: "inalcanzable",
      eventos: ["beneficiario_nuevo", "monto_anomalo", "dispositivo_nuevo"],
      monto: 8400,
    };
    expect(decidir(entrada)).toEqual(decidir(entrada));
  });

  it("el riesgo bajo sigue sin fricción", () => {
    const decision = decidir(base);
    expect(decision.salida).toBe("permitir");
    expect(decision.regla).toBe("E1");
    expect(decision.fondosSalen).toBe(true);
    expect(decision.iaDecideFondos).toBe(false);
    expect(decision.silencioEsAprobacion).toBe(false);
  });

  it("un pago habitual pasa aunque la persona esté inalcanzable y haya otra retención", () => {
    const decision = decidir({
      ...base,
      modo: "inalcanzable",
      monto: 280,
      beneficiarioHabitual: true,
      hayOtraRetencion: true,
    });
    expect(decision.salida).toBe("permitir");
    expect(decision.regla).toBe("E0");
    expect(decision.fondosSalen).toBe(true);
  });

  it("la regla de viaje retiene un beneficiario nuevo sobre S/ 500 si no hay respuesta", () => {
    const decision = decidir({
      ...base,
      modo: "inalcanzable",
      eventos: ["beneficiario_nuevo", "monto_anomalo", "dispositivo_nuevo"],
      monto: 8400,
      vozDisponible: false,
    });
    expect(decision.salida).toBe("retencion_protectora");
    expect(decision.regla).toBe("E6");
    expect(decision.fondosSalen).toBe(false);
    expect(decision.politicaCitada).toMatch(/viaje/i);
    expect(decision.equivalentePolicy).toBe("PAUSAR");
  });

  it("sin la regla de viaje, el silencio de un riesgo alto tampoco aprueba", () => {
    const decision = decidir({
      ...base,
      modo: "inalcanzable",
      politicaViajeActiva: false,
      eventos: ["beneficiario_nuevo", "monto_anomalo", "dispositivo_nuevo"],
      monto: 8400,
    });
    expect(decision.regla).toBe("E4");
    expect(decision.salida).toBe("retencion_protectora");
    expect(decision.fondosSalen).toBe(false);
  });

  it("estar inalcanzable no suma puntaje", () => {
    const con = decidir({
      ...base,
      modo: "inalcanzable",
      eventos: ["beneficiario_nuevo", "monto_anomalo", "usuario_inalcanzable"],
      monto: 2200,
    });
    const sin = decidir({
      ...base,
      modo: "inalcanzable",
      eventos: ["beneficiario_nuevo", "monto_anomalo"],
      monto: 2200,
    });
    expect(con.score).toBe(sin.score);
    expect(con.score).toBe(4);
    expect(nivelDe(4)).toBe("medio");
  });

  it("la preferencia de voz no cambia el score y evita la llamada", () => {
    const eventos: EventoRiesgo[] = ["beneficiario_nuevo", "monto_anomalo"];
    const conVoz = decidir({ ...base, eventos, monto: 2200, vozDisponible: true });
    const sinVoz = decidir({
      ...base,
      modo: "canal_alternativo",
      eventos,
      monto: 2200,
      vozDisponible: false,
    });
    expect(sinVoz.score).toBe(conVoz.score);
    expect(sinVoz.salida).toBe("reto_adaptativo");
    expect(sinVoz.regla).toBe("E7");
    expect(sinVoz.canal).toBe("app_escrita");
    expect(sinVoz.canalEvitado).toBe("llamada de voz");
    expect(sinVoz.fondosSalen).toBe(false);
  });

  it("con acceso remoto pregunta fuera de la llamada antes de mover dinero", () => {
    const decision = decidir({
      ...base,
      eventos: ["beneficiario_nuevo", "monto_anomalo", "acceso_remoto"],
      monto: 4800,
      canalAlternativo: "app_escrita",
    });
    expect(decision.score).toBe(7);
    expect(decision.salida).toBe("reto_fuera_de_canal");
    expect(decision.regla).toBe("E3");
    expect(decision.preguntaEstafa).toMatch(/diciendo qué transferir/);
    expect(decision.canalEvitado).toBe("la llamada en curso");
    expect(decision.fondosSalen).toBe(false);
  });

  it("decir que alguien guía escala a una persona, sin soltar fondos", () => {
    const decision = decidir({
      ...base,
      eventos: ["beneficiario_nuevo", "monto_anomalo", "acceso_remoto"],
      monto: 4800,
      respuestaEstafa: "guiado",
    });
    expect(decision.salida).toBe("bloquear_revision");
    expect(decision.regla).toBe("E8");
    expect(decision.fondosSalen).toBe(false);
    expect(decision.motivo.toLowerCase()).not.toMatch(/culpa|ingenua|estúpida/);
  });

  it("un sí bajo presión no es permiso", () => {
    const decision = decidir({
      ...base,
      eventos: ["beneficiario_nuevo", "monto_anomalo", "acceso_remoto"],
      monto: 4800,
      respuestaEstafa: "confirma_igual",
    });
    expect(decision.salida).toBe("bloquear_revision");
    expect(decision.fondosSalen).toBe(false);
  });

  it("riesgo crítico sin respuesta va a revisión humana", () => {
    const decision = decidir({
      ...base,
      modo: "inalcanzable",
      eventos: ["beneficiario_nuevo", "monto_anomalo", "acceso_remoto"],
      monto: 4800,
    });
    expect(decision.salida).toBe("bloquear_revision");
    expect(decision.regla).toBe("E5");
    expect(decision.fondosSalen).toBe(false);
  });

  it("no confirma una operación nueva en el dispositivo comprometido", () => {
    const decision = decidir({
      ...base,
      modo: "dispositivo_comprometido",
      eventos: ["beneficiario_nuevo"],
      monto: 200,
    });
    expect(decision.salida).toBe("reto_fuera_de_canal");
    expect(decision.canal).toBe("segundo_dispositivo");
    expect(decision.canalEvitado).toMatch(/dispositivo/);
    expect(decision.fondosSalen).toBe(false);
  });

  it("no suelta una operación de riesgo alto cuando nadie puede responder", () => {
    const modos: ModoUsuario[] = ["inalcanzable"];
    const combinaciones: EventoRiesgo[][] = [
      ["beneficiario_nuevo", "monto_anomalo", "dispositivo_nuevo"],
      ["acceso_remoto", "beneficiario_nuevo"],
      ["dispositivo_nuevo", "monto_anomalo", "acceso_remoto"],
    ];
    for (const modo of modos) {
      for (const eventos of combinaciones) {
        const decision = decidir({ ...base, modo, eventos, monto: 3000, politicaViajeActiva: false });
        expect(decision.fondosSalen, eventos.join(",")).toBe(false);
        expect(["retencion_protectora", "bloquear_revision"]).toContain(decision.salida);
      }
    }
  });

  it("las señales que puntúan son de la operación", () => {
    expect(Object.keys(PUNTOS_OPERACION).sort()).toEqual(
      ["acceso_remoto", "beneficiario_nuevo", "dispositivo_nuevo", "monto_anomalo"].sort(),
    );
    const prohibidos = ["edad", "discapacidad", "sordo", "ciego", "ingreso", "diagnostic", "vulnerable"];
    for (const clave of Object.keys(base)) {
      for (const prohibido of prohibidos) {
        expect(clave.toLowerCase()).not.toContain(prohibido);
      }
    }
  });
});
