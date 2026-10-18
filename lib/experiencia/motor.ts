/**
 * Motor de la experiencia — cinco salidas, determinista.
 *
 * El orden de los `if` es la especificación. La primera regla que aplica gana.
 * Está alineado al modelo del brief UX (1 entrada, 5 salidas) y al principio
 * del policy engine del banco (`lib/policy/engine.ts`): la IA no mueve dinero.
 *
 * Puntajes de operación, los mismos órdenes de magnitud que el nivel 0:
 * beneficiario nuevo 2, monto anómalo 2, dispositivo nuevo 2, acceso remoto 3.
 * Estar inalcanzable no suma: cambia la respuesta, no el riesgo de la persona.
 */

import type {
  CanalVerificacion,
  Decision,
  EntradaMotor,
  EquivalentePolicy,
  EventoRiesgo,
  NivelRiesgo,
  ReglaId,
  Salida,
  SenalExplicada,
} from "@/lib/experiencia/tipos";

export const PUNTOS_OPERACION = {
  beneficiario_nuevo: 2,
  monto_anomalo: 2,
  dispositivo_nuevo: 2,
  acceso_remoto: 3,
} as const;

export type SenalPuntuable = keyof typeof PUNTOS_OPERACION;

export const PREGUNTA_ESTAFA = "¿Alguien te está diciendo qué transferir, ahora mismo?";

export const POLITICA_VIAJE = "En viaje, un beneficiario nuevo sobre S/ 500 se retiene.";
export const POLITICA_HOTEL = "El pago al Hotel Sol Andino sigue disponible durante una retención.";
export const PREFERENCIA_VOZ = "La voz no me sirve. Prefiero pasos escritos.";

const EQUIV: Record<Salida, EquivalentePolicy> = {
  permitir: "PERMITIR",
  reto_adaptativo: "VERIFICAR",
  reto_fuera_de_canal: "VERIFICAR",
  retencion_protectora: "PAUSAR",
  bloquear_revision: "ESCALAR",
};

const TEXTO: Record<EventoRiesgo, string> = {
  beneficiario_nuevo: "Beneficiario que no estaba en la lista",
  monto_anomalo: "Monto lejos del promedio de la cuenta",
  dispositivo_nuevo: "Dispositivo que no reconocemos",
  acceso_remoto: "Hay una llamada o una sesión guiando la operación",
  usuario_inalcanzable: "La persona no puede responder ahora",
};

export const SALIDAS_ORDEN: Array<{
  id: Salida;
  nivel: string;
  titulo: string;
  resumen: string;
}> = [
  {
    id: "permitir",
    nivel: "Riesgo bajo",
    titulo: "Permitir",
    resumen: "Sigue sin fricción para la persona.",
  },
  {
    id: "reto_adaptativo",
    nivel: "Riesgo medio",
    titulo: "Reto adaptativo",
    resumen: "Canal según disponibilidad y preferencias.",
  },
  {
    id: "reto_fuera_de_canal",
    nivel: "Riesgo alto · la persona responde",
    titulo: "Reto fuera del canal comprometido",
    resumen: "Incluye preguntas de estafa si hay señales.",
  },
  {
    id: "retencion_protectora",
    nivel: "Riesgo alto · la persona no responde",
    titulo: "Retención protectora",
    resumen: "Al volver verifica; se libera o se cancela.",
  },
  {
    id: "bloquear_revision",
    nivel: "Riesgo crítico",
    titulo: "Bloquear y revisión humana",
    resumen: "Una persona decide el caso.",
  },
];

export function nivelDe(score: number): NivelRiesgo {
  if (score >= 7) return "critico";
  if (score >= 5) return "alto";
  if (score >= 3) return "medio";
  return "bajo";
}

function esPuntuable(id: EventoRiesgo): id is SenalPuntuable {
  return id in PUNTOS_OPERACION;
}

interface PlanCanal {
  canal: Exclude<CanalVerificacion, "ninguno">;
  evita: string | null;
  motivo: string;
}

function planCanal(entrada: EntradaMotor): PlanCanal {
  const atacado =
    entrada.modo === "dispositivo_comprometido" ||
    entrada.eventos.includes("dispositivo_nuevo") ||
    entrada.eventos.includes("acceso_remoto");

  if (atacado) {
    return {
      canal: entrada.canalAlternativo,
      evita: entrada.eventos.includes("acceso_remoto")
        ? "la llamada en curso"
        : "el dispositivo de esta operación",
      motivo: "Si hace falta confirmar, no usamos el canal de esta operación.",
    };
  }

  if (!entrada.vozDisponible || entrada.modo === "canal_alternativo") {
    return {
      canal: "app_escrita",
      evita: "llamada de voz",
      motivo: "La voz no está entre las preferencias. Si hace falta confirmar, va por escrito.",
    };
  }

  return {
    canal: "app",
    evita: null,
    motivo: "Si hace falta confirmar, usamos la app.",
  };
}

interface Comun {
  score: number;
  nivel: NivelRiesgo;
  senales: SenalExplicada[];
  plan: PlanCanal;
}

function cierre(
  comun: Comun,
  campos: {
    salida: Salida;
    regla: ReglaId;
    titulo: string;
    motivo: string;
    porqueTitular: string[];
    porqueAnalista: string[];
    politicaCitada: string | null;
    preguntaEstafa: string | null;
    usarCanal: boolean;
  },
): Decision {
  return {
    ...campos,
    canal: campos.usarCanal ? comun.plan.canal : "ninguno",
    canalEvitado: comun.plan.evita,
    canalMotivo: comun.plan.motivo,
    score: comun.score,
    nivel: comun.nivel,
    senales: comun.senales,
    equivalentePolicy: EQUIV[campos.salida],
    fondosSalen: campos.salida === "permitir",
    silencioEsAprobacion: false,
    iaDecideFondos: false,
  };
}

function lineaScore(comun: Comun): string {
  const partes = comun.senales
    .filter((senal) => senal.puntos > 0)
    .map((senal) => `${senal.id} +${senal.puntos}`);
  const detalle = partes.length > 0 ? partes.join(", ") : "sin señales de operación";
  return `Score ${comun.score} (${detalle}). Nivel ${comun.nivel}.`;
}

/**
 * Decide una operación. Misma entrada, misma salida.
 * Ninguna rama usa atributos de la persona.
 */
export function decidir(entrada: EntradaMotor): Decision {
  const senales: SenalExplicada[] = entrada.eventos.map((id) => ({
    id,
    puntos: esPuntuable(id) ? PUNTOS_OPERACION[id] : 0,
    texto: TEXTO[id],
  }));
  const score = senales.reduce((suma, senal) => suma + senal.puntos, 0);
  const nivel = nivelDe(score);
  const comun: Comun = { score, nivel, senales, plan: planCanal(entrada) };
  const inalcanzable =
    entrada.modo === "inalcanzable" || entrada.eventos.includes("usuario_inalcanzable");
  const puede = !inalcanzable;
  const cierreComun = lineaScore(comun);

  const habitualSinRiesgo =
    entrada.beneficiarioHabitual &&
    !entrada.eventos.includes("dispositivo_nuevo") &&
    !entrada.eventos.includes("acceso_remoto") &&
    !entrada.eventos.includes("beneficiario_nuevo");

  // E0 — salida de emergencia: un pago que ya conoce no se congela con otra retención.
  if (habitualSinRiesgo && entrada.permitirHabituales) {
    return cierre(comun, {
      salida: "permitir",
      regla: "E0",
      titulo: "Permitir",
      motivo: "Es un pago habitual y no hay señales de compromiso. Otra retención no congela este pago.",
      porqueTitular: [
        "Este destinatario ya está entre los pagos recurrentes.",
        "La operación no viene de un celular nuevo ni de una llamada.",
        "Puedes pagarlo aunque otra transferencia siga en pausa.",
      ],
      porqueAnalista: [
        cierreComun,
        "Atajo de beneficiario habitual, equivalente a P2 del policy engine.",
        "Salida de emergencia activa. La IA no intervino.",
      ],
      politicaCitada: POLITICA_HOTEL,
      preguntaEstafa: null,
      usarCanal: false,
    });
  }

  if (habitualSinRiesgo && entrada.hayOtraRetencion && !entrada.permitirHabituales) {
    return cierre(comun, {
      salida: "retencion_protectora",
      regla: "E4",
      titulo: "Retención protectora",
      motivo: "La salida de emergencia está apagada, así que este pago habitual también espera.",
      porqueTitular: [
        "El destinatario es conocido.",
        "Pediste que, mientras haya una retención, los pagos habituales también esperen.",
        "Puedes volver a activar la salida de emergencia cuando quieras.",
      ],
      porqueAnalista: [
        cierreComun,
        "Beneficiario habitual, pero la preferencia de salida de emergencia está en no.",
        "No es una señal sobre la persona. Es una preferencia de la cuenta.",
      ],
      politicaCitada: null,
      preguntaEstafa: null,
      usarCanal: false,
    });
  }

  // E8 — ya contestó la interrupción. Un sí bajo presión no suelta el dinero.
  if (entrada.respuestaEstafa === "guiado") {
    return cierre(comun, {
      salida: "bloquear_revision",
      regla: "E8",
      titulo: "Bloquear y revisión humana",
      motivo: "Nos dijiste que alguien te guía. El dinero queda en pausa y una persona del banco revisa el caso.",
      porqueTitular: [
        "No tienes que seguir en la llamada.",
        "No te pedimos claves ni que te justifiques.",
        "El dinero no se mueve mientras una persona mira el caso.",
      ],
      porqueAnalista: [
        cierreComun,
        "Respuesta: hay guía externa. Revisión humana. Fondos retenidos.",
        "No se pide un secreto por el canal de la llamada.",
      ],
      politicaCitada: null,
      preguntaEstafa: PREGUNTA_ESTAFA,
      usarCanal: false,
    });
  }

  if (entrada.respuestaEstafa === "confirma_igual") {
    return cierre(comun, {
      salida: "bloquear_revision",
      regla: "E8",
      titulo: "Bloquear y revisión humana",
      motivo: "Un sí, con la llamada activa y una cuenta nueva, no alcanza para soltar el dinero.",
      porqueTitular: [
        "Escuchamos que quieres hacerla.",
        "Con esa llamada encima, un sí no basta.",
        "Puedes colgar. Una persona del banco revisa el caso y el dinero sigue aquí.",
      ],
      porqueAnalista: [
        cierreComun,
        "El titular afirma querer transferir. Persisten señales de guía y beneficiario nuevo.",
        "No se libera: coerción posible. Revisión humana.",
      ],
      politicaCitada: null,
      preguntaEstafa: PREGUNTA_ESTAFA,
      usarCanal: false,
    });
  }

  if (entrada.respuestaEstafa === "pausa") {
    return cierre(comun, {
      salida: "retencion_protectora",
      regla: "E8",
      titulo: "Retención protectora",
      motivo: "De acuerdo. Nadie mueve ese dinero mientras lo piensas. No hay un reloj que te apure.",
      porqueTitular: [
        "La transferencia queda en pausa.",
        "Puedes cerrar la app y volver cuando quieras.",
        "Nadie te pide que decidas en la llamada.",
      ],
      porqueAnalista: [
        cierreComun,
        "Enfriamiento a pedido del titular. Sin liberación automática.",
      ],
      politicaCitada: null,
      preguntaEstafa: PREGUNTA_ESTAFA,
      usarCanal: false,
    });
  }

  if (entrada.respuestaEstafa === "salida_segura") {
    return cierre(comun, {
      salida: "retencion_protectora",
      regla: "E8",
      titulo: "Retención protectora",
      motivo: "Puedes colgar. El dinero queda en pausa. El número del banco está en tu tarjeta: llama tú, cuando quieras.",
      porqueTitular: [
        "Esta llamada no puede apurarte.",
        "Nosotros no te llamamos para pedirte que muevas dinero.",
        "La transferencia no sale mientras sales de la llamada.",
      ],
      porqueAnalista: [
        cierreComun,
        "Salida segura: el titular corta el guion. No se verifica por quien llamó.",
      ],
      politicaCitada: null,
      preguntaEstafa: PREGUNTA_ESTAFA,
      usarCanal: false,
    });
  }

  // E11 — la persona volvió, confirmó por otro canal y eligió liberar.
  if (
    entrada.verificadoEnCanalSeguro &&
    entrada.liberacionExplicita &&
    !entrada.eventos.includes("acceso_remoto")
  ) {
    return cierre(comun, {
      salida: "permitir",
      regla: "E11",
      titulo: "Permitir",
      motivo: "Confirmaste por un canal distinto al de la operación y elegiste liberarla.",
      porqueTitular: [
        "La verificación no pasó por el celular de la operación.",
        "El dinero sale ahora, porque tú lo decidiste al volver.",
        "Hasta ese momento, la retención lo mantuvo en la cuenta.",
      ],
      porqueAnalista: [
        cierreComun,
        "Liberación explícita tras verificación en canal alternativo.",
        "Sin acceso remoto. Equivale a cerrar la pausa de P7.",
      ],
      politicaCitada: null,
      preguntaEstafa: null,
      usarCanal: false,
    });
  }

  // E12 — reto medio completado por el canal elegido.
  if (
    entrada.verificadoEnCanalSeguro &&
    nivel === "medio" &&
    !entrada.eventos.includes("acceso_remoto") &&
    !entrada.eventos.includes("dispositivo_nuevo") &&
    entrada.modo !== "dispositivo_comprometido"
  ) {
    return cierre(comun, {
      salida: "permitir",
      regla: "E12",
      titulo: "Permitir",
      motivo: "Completaste la confirmación por el canal que configuraste, sin que nadie más apruebe.",
      porqueTitular: [
        "El reto fue por escrito, como pediste.",
        "Lo cerraste sola.",
        "La transferencia puede seguir.",
      ],
      porqueAnalista: [
        cierreComun,
        "Reto completado en el canal declarado. Tercero obligatorio: no.",
      ],
      politicaCitada: entrada.vozDisponible ? null : PREFERENCIA_VOZ,
      preguntaEstafa: null,
      usarCanal: false,
    });
  }

  // E3 — si puede responder y el contexto es de estafa, se pregunta antes de escalar.
  if (puede && (nivel === "critico" || entrada.eventos.includes("acceso_remoto"))) {
    return cierre(comun, {
      salida: "reto_fuera_de_canal",
      regla: "E3",
      titulo: "Reto fuera del canal comprometido",
      motivo: "Hay señales de que alguien puede estar guiando la operación. Preguntamos por escrito, fuera de esa llamada.",
      porqueTitular: [
        "La identidad puede estar bien y, aun así, la operación espera.",
        "No te pedimos claves, códigos ni que sigas las instrucciones de la llamada.",
        "Puedes pausar o salir. Un sí apurado no suelta el dinero.",
      ],
      porqueAnalista: [
        cierreComun,
        "Interrupción antes de mover fondos. Canal evitado: la llamada.",
        "La autenticación no se trata como prueba de intención.",
      ],
      politicaCitada: null,
      preguntaEstafa: PREGUNTA_ESTAFA,
      usarCanal: true,
    });
  }

  // E5 — crítico y no hay a quién preguntar por un canal seguro.
  if (!puede && nivel === "critico") {
    return cierre(comun, {
      salida: "bloquear_revision",
      regla: "E5",
      titulo: "Bloquear y revisión humana",
      motivo: "El riesgo es crítico y no podemos preguntarte por un canal seguro. El dinero espera a que una persona revise el caso.",
      porqueTitular: [
        "No dimos por buena la operación.",
        "El dinero sigue en la cuenta.",
        "Cuando vuelvas, una persona del banco te explica el caso.",
      ],
      porqueAnalista: [
        cierreComun,
        "Sin respuesta posible y score crítico. Revisión humana. Fondos retenidos.",
      ],
      politicaCitada: null,
      preguntaEstafa: null,
      usarCanal: false,
    });
  }

  // E6 — la regla que la persona escribió para cuando no está.
  if (
    entrada.politicaViajeActiva &&
    !puede &&
    entrada.eventos.includes("beneficiario_nuevo") &&
    entrada.monto > entrada.umbralViaje
  ) {
    return cierre(comun, {
      salida: "retencion_protectora",
      regla: "E6",
      titulo: "Retención protectora",
      motivo: `Tu regla de viaje retuvo un beneficiario nuevo por encima de S/ ${entrada.umbralViaje}, porque no pudiste responder.`,
      porqueTitular: [
        "El destinatario no estaba en tu lista.",
        `El monto supera el límite que elegiste (S/ ${entrada.umbralViaje}).`,
        "No hubo respuesta. Eso no se tomó como un sí.",
        "El dinero sigue en tu cuenta.",
      ],
      porqueAnalista: [
        cierreComun,
        "Política del titular citada. Disponibilidad: no puede responder.",
        "El aviso se envió y no hubo acuse. Silencio distinto de aprobación.",
      ],
      politicaCitada: POLITICA_VIAJE,
      preguntaEstafa: null,
      usarCanal: false,
    });
  }

  // E4 — riesgo que no es bajo, y el silencio no aprueba.
  if (!puede && nivel !== "bajo") {
    return cierre(comun, {
      salida: "retencion_protectora",
      regla: "E4",
      titulo: "Retención protectora",
      motivo: "El riesgo no es bajo y no pudiste responder. Retenemos hasta que vuelvas. El silencio no aprueba la operación.",
      porqueTitular: [
        "Te avisamos y no llegó una respuesta.",
        "Por eso el dinero no salió.",
        "Al volver puedes liberar o cancelar, por un canal distinto al de la operación.",
      ],
      porqueAnalista: [
        cierreComun,
        "Disponibilidad: no puede responder. Regla de silencio, equivalente a P7.",
        comun.plan.evita ? `Canal evitado: ${comun.plan.evita}.` : "Sin canal de confirmación usable ahora.",
      ],
      politicaCitada: null,
      preguntaEstafa: null,
      usarCanal: false,
    });
  }

  const dispositivoNoConfiable =
    entrada.modo === "dispositivo_comprometido" || entrada.eventos.includes("dispositivo_nuevo");

  // E3b — puede responder, pero no por el aparato de la operación.
  if (puede && dispositivoNoConfiable && !entrada.beneficiarioHabitual && nivel !== "bajo") {
    return cierre(comun, {
      salida: "reto_fuera_de_canal",
      regla: "E3",
      titulo: "Reto fuera del canal comprometido",
      motivo: "Esta operación pide confirmación, y no la pedimos en el dispositivo que la inició.",
      porqueTitular: [
        "El celular de esta operación no sirve para decir que sí.",
        "La confirmación va por el canal que dejaste preparado.",
        "Mientras tanto, el dinero no sale.",
      ],
      porqueAnalista: [
        cierreComun,
        `Canal propuesto: ${comun.plan.canal}. Canal evitado: ${comun.plan.evita ?? "el de la operación"}.`,
      ],
      politicaCitada: null,
      preguntaEstafa: null,
      usarCanal: true,
    });
  }

  if (puede && entrada.modo === "dispositivo_comprometido" && !entrada.beneficiarioHabitual) {
    return cierre(comun, {
      salida: "reto_fuera_de_canal",
      regla: "E3",
      titulo: "Reto fuera del canal comprometido",
      motivo: "El dispositivo de la cuenta no está para confirmar. Aunque el monto sea pequeño, una operación nueva no se aprueba desde ahí.",
      porqueTitular: [
        "No usamos ese celular para decir que sí.",
        "Puedes confirmar desde el canal que dejaste preparado.",
      ],
      porqueAnalista: [
        cierreComun,
        "Modo dispositivo comprometido. Sin aprobación por ese canal, también con score bajo.",
      ],
      politicaCitada: null,
      preguntaEstafa: null,
      usarCanal: true,
    });
  }

  // E7 — hace falta un reto y la voz no está disponible como preferencia.
  if (puede && nivel === "medio" && (!entrada.vozDisponible || entrada.modo === "canal_alternativo")) {
    return cierre(comun, {
      salida: "reto_adaptativo",
      regla: "E7",
      titulo: "Reto adaptativo",
      motivo: "Hace falta una confirmación. No usamos una llamada: la voz no está entre tus preferencias.",
      porqueTitular: [
        "El reto es por escrito, en la app.",
        "No hace falta explicar por qué la voz no te sirve.",
        "Lo puedes completar sola. Nadie más tiene que aprobar.",
      ],
      porqueAnalista: [
        cierreComun,
        "Preferencia de canal declarada: voz no disponible. No es un dato de salud y no entra al score.",
        "Canal elegido: pasos escritos. Tercero obligatorio: no.",
      ],
      politicaCitada: PREFERENCIA_VOZ,
      preguntaEstafa: null,
      usarCanal: true,
    });
  }

  // E2 — riesgo medio y la persona puede responder por su canal de siempre.
  if (puede && nivel === "medio") {
    return cierre(comun, {
      salida: "reto_adaptativo",
      regla: "E2",
      titulo: "Reto adaptativo",
      motivo: "El riesgo es medio. Pedimos una confirmación breve en la app, sin bloquear la cuenta.",
      porqueTitular: [
        "No es un bloqueo.",
        "Es una confirmación corta, en el canal que ya usas.",
      ],
      porqueAnalista: [
        cierreComun,
        "Reto adaptativo en app. Sin escalar a una persona.",
      ],
      politicaCitada: null,
      preguntaEstafa: null,
      usarCanal: true,
    });
  }

  // E1 — riesgo bajo. No congelar la cuenta a ciegas.
  if (nivel === "bajo" && entrada.modo !== "dispositivo_comprometido") {
    return cierre(comun, {
      salida: "permitir",
      regla: "E1",
      titulo: "Permitir",
      motivo: "El riesgo de esta operación es bajo. Sigue sin fricción.",
      porqueTitular: ["No vimos una combinación de señales que justifique pausarla."],
      porqueAnalista: [cierreComun, "Nivel bajo. Sin fricción agregada."],
      politicaCitada: null,
      preguntaEstafa: null,
      usarCanal: false,
    });
  }

  // E10 — sin información suficiente, no se suelta el dinero.
  return cierre(comun, {
    salida: "retencion_protectora",
    regla: "E10",
    titulo: "Retención protectora",
    motivo: "No hay suficiente para soltar el dinero. Queda en pausa hasta que se aclare.",
    porqueTitular: ["Mientras tanto, la operación no sale de la cuenta."],
    porqueAnalista: [cierreComun, "Falla segura: sin regla de permiso, se retiene."],
    politicaCitada: null,
    preguntaEstafa: null,
    usarCanal: false,
  });
}
