import { decidir } from "@/lib/experiencia/motor";
import type {
  Decision,
  EntradaMotor,
  EventoRiesgo,
  Hecho,
  ModoUsuario,
  MovimientoExtra,
  Operacion,
  RespuestaEstafa,
  Retencion,
} from "@/lib/experiencia/tipos";

export type EscenarioId = "viajero" | "manipulado" | "canal";
export type Vista = "recorrido" | "probar";
export type Resolucion = "cancelada" | "liberada" | null;

export type PasoId =
  | "calma"
  | "viaje"
  | "contraste"
  | "regreso"
  | "cierre"
  | "llamada"
  | "interrupcion"
  | "resultado"
  | "preferencia"
  | "llamada_estandar"
  | "escrito"
  | "listo";

export interface Estado {
  vista: Vista;
  escenario: EscenarioId;
  paso: PasoId;
  modo: ModoUsuario;
  vozDisponible: boolean;
  politicaViaje: boolean;
  permitirHabituales: boolean;
  umbralViaje: number;
  canalAlternativo: EntradaMotor["canalAlternativo"];
  operacion: Operacion | null;
  respuestaEstafa: RespuestaEstafa | null;
  verificado: boolean;
  liberacionExplicita: boolean;
  retencion: Retencion | null;
  resolucion: Resolucion;
  decisionTomada: Decision | null;
  hotelPagado: boolean;
  hotelBloqueado: boolean;
  movimientosExtra: MovimientoExtra[];
  hechos: Hecho[];
  seq: number;
  dispositivoAtaque: boolean;
  codigoError: boolean;
  pruebaModo: ModoUsuario;
  pruebaEventos: EventoRiesgo[];
  pruebaMonto: number;
  pruebaHabitual: boolean;
}

export type Accion =
  | { type: "vista"; vista: Vista }
  | { type: "escenario"; id: EscenarioId }
  | { type: "reiniciar" }
  | { type: "voz"; valor: boolean }
  | { type: "politica"; valor: boolean }
  | { type: "habituales"; valor: boolean }
  | { type: "prueba_modo"; modo: ModoUsuario }
  | { type: "prueba_eventos"; eventos: EventoRiesgo[] }
  | { type: "prueba_monto"; monto: number }
  | { type: "prueba_hotel" }
  | { type: "avanzar"; id: string; codigo?: string };

export const CODIGO_VISIBLE = "4812";
export const MONTO_HOTEL = 280;

const OP_VIAJE: Operacion = {
  id: "op-viaje",
  destino: "Carlos R.",
  detalle: "Cuenta nueva · no está en tus beneficiarios",
  monto: 8400,
  habitual: false,
  eventos: ["beneficiario_nuevo", "monto_anomalo", "dispositivo_nuevo"],
};

const OP_LLAMADA: Operacion = {
  id: "op-llamada",
  destino: "Cuenta de resguardo",
  detalle: "Beneficiario nuevo · te lo dictan por teléfono",
  monto: 4800,
  habitual: false,
  eventos: ["beneficiario_nuevo", "monto_anomalo", "acceso_remoto"],
};

const OP_CANAL: Operacion = {
  id: "op-canal",
  destino: "Taller Rojas",
  detalle: "Beneficiario nuevo",
  monto: 2200,
  habitual: false,
  eventos: ["beneficiario_nuevo", "monto_anomalo"],
};

function base(escenario: EscenarioId): Estado {
  return {
    vista: "recorrido",
    escenario,
    paso: "calma",
    modo: "disponible",
    vozDisponible: false,
    politicaViaje: true,
    permitirHabituales: true,
    umbralViaje: 500,
    canalAlternativo: "segundo_dispositivo",
    operacion: null,
    respuestaEstafa: null,
    verificado: false,
    liberacionExplicita: false,
    retencion: null,
    resolucion: null,
    decisionTomada: null,
    hotelPagado: false,
    hotelBloqueado: false,
    movimientosExtra: [],
    hechos: [],
    seq: 0,
    dispositivoAtaque: false,
    codigoError: false,
    pruebaModo: "disponible",
    pruebaEventos: [],
    pruebaMonto: 200,
    pruebaHabitual: false,
  };
}

export function crearEstado(escenario: EscenarioId = "viajero"): Estado {
  if (escenario === "manipulado") {
    return { ...base(escenario), paso: "llamada", canalAlternativo: "app_escrita" };
  }
  if (escenario === "canal") {
    return { ...base(escenario), paso: "preferencia", canalAlternativo: "app_escrita" };
  }
  return base(escenario);
}

export function entradaDe(estado: Estado): EntradaMotor | null {
  if (!estado.operacion) return null;
  return {
    modo: estado.modo,
    eventos: estado.operacion.eventos,
    monto: estado.operacion.monto,
    beneficiarioHabitual: estado.operacion.habitual,
    politicaViajeActiva: estado.politicaViaje,
    umbralViaje: estado.umbralViaje,
    vozDisponible: estado.vozDisponible,
    canalAlternativo: estado.canalAlternativo,
    respuestaEstafa: estado.respuestaEstafa,
    verificadoEnCanalSeguro: estado.verificado,
    liberacionExplicita: estado.liberacionExplicita,
    permitirHabituales: estado.permitirHabituales,
    hayOtraRetencion: false,
  };
}

export function entradaPrueba(estado: Estado): EntradaMotor {
  return {
    modo: estado.pruebaModo,
    eventos: estado.pruebaEventos,
    monto: estado.pruebaMonto,
    beneficiarioHabitual: estado.pruebaHabitual,
    politicaViajeActiva: estado.politicaViaje,
    umbralViaje: estado.umbralViaje,
    vozDisponible: estado.vozDisponible,
    canalAlternativo: estado.canalAlternativo,
    respuestaEstafa: null,
    verificadoEnCanalSeguro: false,
    liberacionExplicita: false,
    permitirHabituales: estado.permitirHabituales,
    hayOtraRetencion: estado.pruebaHabitual,
  };
}

export function decisionDelMomento(estado: Estado): Decision | null {
  if (estado.vista === "probar") return decidir(entradaPrueba(estado));
  if (estado.resolucion === "cancelada") return estado.decisionTomada;
  const entrada = entradaDe(estado);
  return entrada ? decidir(entrada) : null;
}

export function entradaHotel(estado: Estado): EntradaMotor {
  return {
    modo: estado.modo,
    eventos: [],
    monto: MONTO_HOTEL,
    beneficiarioHabitual: true,
    politicaViajeActiva: estado.politicaViaje,
    umbralViaje: estado.umbralViaje,
    vozDisponible: estado.vozDisponible,
    canalAlternativo: estado.canalAlternativo,
    respuestaEstafa: null,
    verificadoEnCanalSeguro: false,
    liberacionExplicita: false,
    permitirHabituales: estado.permitirHabituales,
    hayOtraRetencion: estado.retencion?.estado === "activa",
  };
}

function agregar(estado: Estado, parcial: Omit<Hecho, "id">): Estado {
  const n = estado.seq + 1;
  const hecho: Hecho = { id: `E-${String(n).padStart(2, "0")}`, ...parcial };
  return { ...estado, seq: n, hechos: [...estado.hechos, hecho] };
}

function pagarHotel(estado: Estado): Estado {
  if (estado.hotelPagado) return estado;
  const decision = decidir(entradaHotel(estado));
  if (decision.salida !== "permitir") {
    return agregar(
      { ...estado, hotelBloqueado: true },
      {
        cuando: "Día 1 · 19:40",
        titularTitulo: "El hotel quedó en espera",
        titularDetalle: "La salida de emergencia está apagada. Puedes volver a activarla y pagar.",
        analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
        analistaDetalle: decision.porqueAnalista.join(" "),
      },
    );
  }
  return agregar(
    {
      ...estado,
      hotelPagado: true,
      hotelBloqueado: false,
      movimientosExtra: [
        ...estado.movimientosExtra,
        {
          id: "mov-hotel",
          cuando: "Día 1 · 19:40",
          concepto: "Hotel Sol Andino",
          monto: -MONTO_HOTEL,
        },
      ],
    },
    {
      cuando: "Día 1 · 19:40",
      titularTitulo: "Pagaste el hotel",
      titularDetalle: "S/ 280 al Hotel Sol Andino. Este pago sí salió. La otra transferencia sigue en pausa.",
      analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
      analistaDetalle: decision.porqueAnalista.join(" "),
    },
  );
}

function avanzarViajero(estado: Estado, id: string): Estado {
  if (id === "repetir") return crearEstado("viajero");
  if (estado.paso === "calma" && id === "salir") {
    return agregar(
      { ...estado, paso: "viaje", modo: "inalcanzable" },
      {
        cuando: "Día 1 · 08:12",
        titularTitulo: "Saliste de viaje",
        titularDetalle: "Quedaste sin señal. La regla que escribiste para el viaje sigue activa.",
        analistaTitulo: "Disponibilidad: inalcanzable",
        analistaDetalle:
          "No suma puntaje. Cambia la respuesta del sistema. Política de viaje activa, umbral S/ 500. Canal alternativo: tablet de casa.",
      },
    );
  }
  if (estado.paso === "viaje" && id === "ataque") {
    const siguiente: Estado = {
      ...estado,
      paso: "contraste",
      operacion: OP_VIAJE,
      dispositivoAtaque: true,
    };
    const decision = decidir(entradaDe(siguiente)!);
    const conRetencion: Estado = {
      ...siguiente,
      decisionTomada: decision,
      retencion: { id: "ret-viaje", destino: OP_VIAJE.destino, monto: OP_VIAJE.monto, estado: "activa" },
    };
    return agregar(
      agregar(conRetencion, {
        cuando: "Día 1 · 14:02",
        titularTitulo: "Te avisamos",
        titularDetalle:
          "Un celular que no reconocemos intentó transferir S/ 8,400 a Carlos R. El aviso salió. No hubo respuesta.",
        analistaTitulo: "Alerta sin acuse",
        analistaDetalle:
          "Dispositivo no registrado. Beneficiario fuera del padrón. Monto S/ 8,400. Canal del aviso: app del celular habitual. Respuesta: ninguna.",
      }),
      {
        cuando: "Día 1 · 14:02",
        titularTitulo: "El dinero no salió",
        titularDetalle: decision.motivo,
        analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
        analistaDetalle: decision.porqueAnalista.join(" "),
      },
    );
  }
  if ((estado.paso === "contraste" || estado.paso === "regreso") && id === "hotel") {
    return pagarHotel(estado);
  }
  if (estado.paso === "contraste" && id === "volver") {
    return agregar(
      { ...estado, paso: "regreso" },
      {
        cuando: "Día 3 · 11:05",
        titularTitulo: "Volviste",
        titularDetalle: "Pasaron 48 horas. El dinero retenido sigue en la cuenta.",
        analistaTitulo: "Titular alcanzable de nuevo",
        analistaDetalle:
          "Ventana de la retención: 48 h. Operación activa. Pendiente de verificación por la tablet, no por el Android nuevo.",
      },
    );
  }
  if (estado.paso === "regreso" && id === "verificar" && !estado.verificado) {
    return agregar(
      { ...estado, verificado: true },
      {
        cuando: "Día 3 · 11:06",
        titularTitulo: "Confirmaste con la tablet",
        titularDetalle: "No usamos el celular nuevo. Nadie más tuvo que aprobar.",
        analistaTitulo: "Verificación por segundo dispositivo",
        analistaDetalle:
          "Canal usado: tablet de casa. Canal evitado: Android no registrado. Tercero obligatorio: no.",
      },
    );
  }
  if (estado.paso === "regreso" && estado.verificado && id === "cancelar" && estado.retencion) {
    return agregar(
      {
        ...estado,
        paso: "cierre",
        resolucion: "cancelada",
        retencion: { ...estado.retencion, estado: "cancelada" },
      },
      {
        cuando: "Día 3 · 11:07",
        titularTitulo: "Cancelaste la transferencia",
        titularDetalle: "S/ 8,400 nunca salieron. Vuelven a estar disponibles.",
        analistaTitulo: "Operación cancelada por el titular",
        analistaDetalle: `Tras verificación en canal alternativo. Regla de origen ${estado.decisionTomada?.regla ?? "E6"}. Fondos no movidos.`,
      },
    );
  }
  if (estado.paso === "regreso" && estado.verificado && id === "liberar" && estado.retencion) {
    const siguiente: Estado = {
      ...estado,
      verificado: true,
      liberacionExplicita: true,
      paso: "cierre",
      resolucion: "liberada",
      retencion: { ...estado.retencion, estado: "liberada" },
      movimientosExtra: [
        ...estado.movimientosExtra,
        { id: "mov-carlos", cuando: "Día 3 · 11:07", concepto: "Carlos R.", monto: -OP_VIAJE.monto },
      ],
    };
    const decision = decidir(entradaDe(siguiente)!);
    return agregar(
      { ...siguiente, decisionTomada: decision },
      {
        cuando: "Día 3 · 11:07",
        titularTitulo: "Liberaste la transferencia",
        titularDetalle: "Confirmaste que sí era tuya. S/ 8,400 salieron después de tu decisión, no antes.",
        analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
        analistaDetalle: decision.porqueAnalista.join(" "),
      },
    );
  }
  return estado;
}

function retenerLlamada(estado: Estado, respuesta: RespuestaEstafa): Estado {
  const siguiente: Estado = { ...estado, respuestaEstafa: respuesta, paso: "resultado" };
  const decision = decidir(entradaDe(siguiente)!);
  const con: Estado = {
    ...siguiente,
    decisionTomada: decision,
    retencion: {
      id: "ret-llamada",
      destino: OP_LLAMADA.destino,
      monto: OP_LLAMADA.monto,
      estado: "activa",
    },
  };
  const textos: Record<RespuestaEstafa, Omit<Hecho, "id">> = {
    guiado: {
      cuando: "Hoy · 18:12",
      titularTitulo: "La transferencia queda en pausa",
      titularDetalle: "Una persona del banco la revisa. Puedes colgar. No tienes que justificarte.",
      analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
      analistaDetalle: decision.porqueAnalista.join(" "),
    },
    pausa: {
      cuando: "Hoy · 18:12",
      titularTitulo: "Pausa para pensar",
      titularDetalle: "Nadie mueve ese dinero mientras decides. No hay un reloj que te apure.",
      analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
      analistaDetalle: decision.porqueAnalista.join(" "),
    },
    salida_segura: {
      cuando: "Hoy · 18:12",
      titularTitulo: "Puedes colgar",
      titularDetalle: "El dinero queda en pausa. Llama tú al número de tu tarjeta, cuando quieras.",
      analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
      analistaDetalle: decision.porqueAnalista.join(" "),
    },
    confirma_igual: {
      cuando: "Hoy · 18:12",
      titularTitulo: "Un sí no alcanza",
      titularDetalle:
        "Con la llamada activa y una cuenta nueva, el dinero sigue en pausa para que una persona lo revise. Puedes colgar.",
      analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
      analistaDetalle: decision.porqueAnalista.join(" "),
    },
  };
  return agregar(con, textos[respuesta]);
}

function avanzarManipulado(estado: Estado, id: string): Estado {
  if (id === "repetir") return crearEstado("manipulado");
  if (estado.paso === "llamada" && id === "transferir") {
    const siguiente: Estado = { ...estado, paso: "interrupcion", operacion: OP_LLAMADA };
    const decision = decidir(entradaDe(siguiente)!);
    return agregar(
      agregar(
        { ...siguiente, decisionTomada: decision },
        {
          cuando: "Hoy · 18:11",
          titularTitulo: "La identidad coincidió",
          titularDetalle: "Tu celular, tu biometría y el código. La transferencia todavía no sale.",
          analistaTitulo: "Autenticación correcta",
          analistaDetalle:
            "Dispositivo habitual. Biometría correcta. OTP correcto. Señales: beneficiario nuevo, monto anómalo, acceso remoto. La autenticación no cierra la intención.",
        },
      ),
      {
        cuando: "Hoy · 18:11",
        titularTitulo: "Te preguntamos con calma",
        titularDetalle: "¿Alguien te está diciendo qué transferir, ahora mismo? No pedimos claves.",
        analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
        analistaDetalle: decision.porqueAnalista.join(" "),
      },
    );
  }
  if (estado.paso === "interrupcion" && (id === "guiado" || id === "pausa" || id === "salida" || id === "confirma")) {
    const mapa: Record<string, RespuestaEstafa> = {
      guiado: "guiado",
      pausa: "pausa",
      salida: "salida_segura",
      confirma: "confirma_igual",
    };
    return retenerLlamada(estado, mapa[id]);
  }
  return estado;
}

function avanzarCanal(estado: Estado, id: string, codigo?: string): Estado {
  if (id === "repetir") return crearEstado("canal");
  if (estado.paso === "preferencia" && id === "simular") {
    const modo = estado.vozDisponible ? "disponible" : "canal_alternativo";
    const siguiente: Estado = {
      ...estado,
      operacion: OP_CANAL,
      modo,
      paso: estado.vozDisponible ? "llamada_estandar" : "escrito",
    };
    const decision = decidir(entradaDe(siguiente)!);
    return agregar(
      { ...siguiente, decisionTomada: decision },
      estado.vozDisponible
        ? {
            cuando: "Hoy · 16:18",
            titularTitulo: "Hace falta confirmar",
            titularDetalle: "S/ 2,200 a Taller Rojas. En muchos bancos el siguiente paso sería una llamada.",
            analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
            analistaDetalle: decision.porqueAnalista.join(" "),
          }
        : {
            cuando: "Hoy · 16:18",
            titularTitulo: "Hace falta confirmar",
            titularDetalle:
              "S/ 2,200 a Taller Rojas, una cuenta nueva. No te llamamos: la voz no está entre tus preferencias.",
            analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
            analistaDetalle: decision.porqueAnalista.join(" "),
          },
    );
  }
  if (estado.paso === "llamada_estandar" && id === "no_puedo") {
    const siguiente: Estado = {
      ...estado,
      vozDisponible: false,
      modo: "canal_alternativo",
      paso: "escrito",
    };
    const decision = decidir(entradaDe(siguiente)!);
    return agregar(
      { ...siguiente, decisionTomada: decision },
      {
        cuando: "Hoy · 16:19",
        titularTitulo: "Seguimos sin la llamada",
        titularDetalle: "Pasamos a pasos escritos. No hace falta decir por qué la voz no te sirve.",
        analistaTitulo: "Canal reasignado",
        analistaDetalle: `${decision.porqueAnalista.join(" ")} Preferencia actualizada por el titular.`,
      },
    );
  }
  if (estado.paso === "escrito" && id === "confirmar") {
    if (codigo !== CODIGO_VISIBLE) return { ...estado, codigoError: true };
    const siguiente: Estado = { ...estado, verificado: true, codigoError: false, paso: "listo" };
    const decision = decidir(entradaDe(siguiente)!);
    const conMov: Estado = {
      ...siguiente,
      decisionTomada: decision,
      movimientosExtra: [
        ...estado.movimientosExtra,
        { id: "mov-taller", cuando: "Hoy · 16:20", concepto: "Taller Rojas", monto: -OP_CANAL.monto },
      ],
    };
    return agregar(conMov, {
      cuando: "Hoy · 16:20",
      titularTitulo: "Lo confirmaste sola",
      titularDetalle: "El código escrito y tu último pago habitual alcanzaron. Nadie más intervino.",
      analistaTitulo: `${decision.equivalentePolicy} · ${decision.regla}`,
      analistaDetalle: decision.porqueAnalista.join(" "),
    });
  }
  return estado;
}

export function reducir(estado: Estado, accion: Accion): Estado {
  switch (accion.type) {
    case "vista":
      return { ...estado, vista: accion.vista };
    case "escenario":
      return crearEstado(accion.id);
    case "reiniciar":
      return crearEstado(estado.escenario);
    case "voz":
      return { ...estado, vozDisponible: accion.valor };
    case "politica":
      return { ...estado, politicaViaje: accion.valor };
    case "habituales":
      return { ...estado, permitirHabituales: accion.valor };
    case "prueba_modo":
      return { ...estado, pruebaModo: accion.modo };
    case "prueba_eventos":
      return { ...estado, pruebaEventos: accion.eventos, pruebaHabitual: false };
    case "prueba_monto":
      return { ...estado, pruebaMonto: accion.monto, pruebaHabitual: false };
    case "prueba_hotel":
      return { ...estado, pruebaHabitual: true, pruebaMonto: MONTO_HOTEL, pruebaEventos: [] };
    case "avanzar":
      if (estado.escenario === "viajero") return avanzarViajero(estado, accion.id);
      if (estado.escenario === "manipulado") return avanzarManipulado(estado, accion.id);
      return avanzarCanal(estado, accion.id, accion.codigo);
    default:
      return estado;
  }
}
