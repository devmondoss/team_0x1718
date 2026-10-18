import type { Estado, PasoId } from "@/lib/experiencia/estado";

export interface AccionUi {
  id: string;
  etiqueta: string;
  variante: "primaria" | "secundaria" | "calma";
  ayuda?: string;
}

export interface TextoPaso {
  kicker: string;
  titulo: string;
  parrafos: string[];
  acciones: AccionUi[];
}

export interface Escalón {
  nombre: string;
  actual: boolean;
  hecho: boolean;
}

export function escalones(estado: Estado): Escalón[] {
  const grupos: Array<{ ids: PasoId[]; nombre: string }> =
    estado.escenario === "viajero"
      ? [
          { ids: ["calma"], nombre: "Cuenta" },
          { ids: ["viaje"], nombre: "Sin señal" },
          { ids: ["contraste"], nombre: "Retención" },
          { ids: ["regreso"], nombre: "Regreso" },
          { ids: ["cierre"], nombre: "Decisión" },
        ]
      : estado.escenario === "manipulado"
        ? [
            { ids: ["llamada"], nombre: "La llamada" },
            { ids: ["interrupcion"], nombre: "La pregunta" },
            { ids: ["resultado"], nombre: "La pausa" },
          ]
        : [
            { ids: ["preferencia"], nombre: "Preferencia" },
            { ids: ["llamada_estandar", "escrito"], nombre: "Reto" },
            { ids: ["listo"], nombre: "Lista" },
          ];
  const actual = grupos.findIndex((grupo) => grupo.ids.includes(estado.paso));
  return grupos.map((grupo, indice) => ({
    nombre: grupo.nombre,
    actual: indice === actual,
    hecho: actual >= 0 && indice < actual,
  }));
}

export function textoPaso(estado: Estado): TextoPaso {
  if (estado.escenario === "manipulado") return textoManipulado(estado);
  if (estado.escenario === "canal") return textoCanal(estado);
  return textoViajero(estado);
}

function textoViajero(estado: Estado): TextoPaso {
  if (estado.paso === "calma") {
    return {
      kicker: "Antes del viaje",
      titulo: "Un historial tranquilo",
      parrafos: [
        "Lucía paga el mercado, la luz y el hotel. Mañana sale de Lima, sin roaming.",
        "La protección de viaje ya está escrita, en una frase: un beneficiario nuevo sobre S/ 500 se retiene.",
      ],
      acciones: [{ id: "salir", etiqueta: "Salir de viaje, sin señal", variante: "primaria" }],
    };
  }
  if (estado.paso === "viaje") {
    return {
      kicker: "Estado C · inalcanzable",
      titulo: "Sin señal",
      parrafos: [
        "El celular no tiene cómo recibir el aviso. La regla de Lucía sigue activa igual.",
        "Un rato después, alguien intenta mover dinero desde un celular que ella no reconoce.",
      ],
      acciones: [{ id: "ataque", etiqueta: "Llega la operación riesgosa", variante: "primaria" }],
    };
  }
  if (estado.paso === "contraste") {
    return {
      kicker: "El silencio no es un sí",
      titulo: "El dinero no sale",
      parrafos: [
        "Avisamos al celular. Nadie vio el aviso. Hoy, en muchos bancos, ese silencio deja pasar la transferencia.",
        "Aquí la retención ya está hecha. S/ 8,400 siguen en la cuenta. El hotel, si hace falta, se puede pagar aparte.",
        estado.hotelPagado
          ? "El hotel ya cobró S/ 280. La transferencia a Carlos R. sigue en pausa."
          : estado.hotelBloqueado
            ? "El hotel quedó en espera porque la salida de emergencia está apagada. Puedes activarla en la cuenta y volver a intentar."
            : "",
      ].filter(Boolean),
      acciones: [
        ...(estado.hotelPagado
          ? []
          : [
              {
                id: "hotel",
                etiqueta: "Pagar el hotel, S/ 280",
                variante: "secundaria" as const,
                ayuda: "Un pago habitual no espera a que se resuelva la retención.",
              },
            ]),
        { id: "volver", etiqueta: "Pasaron 48 horas. Lucía vuelve", variante: "primaria" },
      ],
    };
  }
  if (estado.paso === "regreso") {
    return {
      kicker: "El momento del regreso",
      titulo: "Tu dinero sigue aquí",
      parrafos: [
        "Hola de nuevo. Pasaron 48 horas.",
        "Un celular que no es el tuyo intentó enviar S/ 8,400 a una cuenta nueva. Te avisamos. No hubo respuesta. Tu regla de viaje dice que eso se retiene.",
        estado.verificado
          ? "La tablet ya confirmó que eres tú. Nadie más tiene que decidir. ¿Esta transferencia era tuya?"
          : "Para cancelar o liberar, confirma con la tablet de tu casa. No usamos el celular nuevo.",
      ],
      acciones: estado.verificado
        ? [
            { id: "cancelar", etiqueta: "No fui yo: cancelar", variante: "primaria" },
            { id: "liberar", etiqueta: "Sí fui yo: liberar", variante: "secundaria" },
          ]
        : [
            {
              id: "verificar",
              etiqueta: "Confirmar con la tablet",
              variante: "primaria",
              ayuda: "Lo haces tú. No hace falta que alguien más apruebe.",
            },
            ...(estado.hotelPagado
              ? []
              : [{ id: "hotel", etiqueta: "Pagar el hotel, S/ 280", variante: "secundaria" as const }]),
          ],
    };
  }
  return {
    kicker: "Quedó explicado",
    titulo: estado.resolucion === "liberada" ? "La liberaste al volver" : "La cancelaste al volver",
    parrafos:
      estado.resolucion === "liberada"
        ? [
            "S/ 8,400 salieron recién cuando tú lo dijiste, desde la tablet.",
            "Durante las 48 horas sin señal, el dinero no se movió. El silencio no se tomó como un sí.",
          ]
        : [
            "S/ 8,400 nunca salieron. La cuenta no quedó bloqueada: solo esa operación se detuvo.",
            "El aviso existió y nadie lo vio. Aun así, la retención protegió el saldo hasta que volviste.",
          ],
    acciones: [{ id: "repetir", etiqueta: "Repetir este recorrido", variante: "secundaria" }],
  };
}

function textoManipulado(estado: Estado): TextoPaso {
  if (estado.paso === "llamada") {
    return {
      kicker: "Estado F · autenticada, pero guiada",
      titulo: "Llama alguien que dice ser del banco",
      parrafos: [
        "Le piden mover S/ 4,800 a una «cuenta de resguardo». El celular es el de Lucía. Ella está en Lima y puede responder.",
        "La llamada apura. El siguiente paso, en el banco de hoy, sería autenticar y dejar salir el dinero.",
      ],
      acciones: [{ id: "transferir", etiqueta: "Transferir con biometría", variante: "primaria" }],
    };
  }
  if (estado.paso === "interrupcion") {
    return {
      kicker: "La interrupción",
      titulo: "Antes de continuar",
      parrafos: [
        "El celular, la biometría y el código coinciden. Eso dice quién está al aparato, no si la operación es suya de verdad.",
        "No te pedimos claves ni que sigas las instrucciones de quien llama.",
      ],
      acciones: [
        { id: "guiado", etiqueta: "Sí, alguien me está guiando", variante: "primaria" },
        { id: "pausa", etiqueta: "Quiero pensarlo con calma", variante: "secundaria" },
        { id: "salida", etiqueta: "Salir y llamar yo al banco", variante: "secundaria" },
        {
          id: "confirma",
          etiqueta: "Sí, quiero transferir igual",
          variante: "calma",
          ayuda: "Un sí, con la llamada activa, no suelta el dinero.",
        },
      ],
    };
  }
  const titulo =
    estado.respuestaEstafa === "guiado"
      ? "Gracias por decirlo"
      : estado.respuestaEstafa === "pausa"
        ? "Sin apuro"
        : estado.respuestaEstafa === "salida_segura"
          ? "Puedes colgar"
          : "Un sí no alcanza";
  return {
    kicker: "El dinero no se movió",
    titulo,
    parrafos: [
      estado.respuestaEstafa === "guiado"
        ? "Pausamos la transferencia y una persona del banco la mira. No tienes que seguir hablando con quien llamó, ni explicar nada más."
        : estado.respuestaEstafa === "pausa"
          ? "La transferencia queda en pausa. Puedes cerrar esto y volver cuando quieras. No hay un contador que te empuje."
          : estado.respuestaEstafa === "salida_segura"
            ? "Cuelga cuando quieras. El número del banco está en tu tarjeta o en un comprobante anterior. Esta llamada no es ese canal."
            : "Escuchamos que quieres hacer la transferencia. Con una llamada activa y una cuenta nueva, eso no basta para soltar el dinero. Una persona revisa el caso. Puedes colgar.",
      "S/ 4,800 siguen en la cuenta.",
    ],
    acciones: [{ id: "repetir", etiqueta: "Repetir este recorrido", variante: "secundaria" }],
  };
}

function textoCanal(estado: Estado): TextoPaso {
  if (estado.paso === "preferencia") {
    return {
      kicker: "Estado D · el canal de siempre no sirve",
      titulo: "Cómo quieres que te preguntemos",
      parrafos: [
        "Esto se configura antes, con calma. No hace falta contar un motivo ni pedir que alguien más te represente.",
        "La frase de Lucía es una preferencia de canal. No cambia su riesgo y no entra al puntaje.",
      ],
      acciones: [{ id: "simular", etiqueta: "Simular una transferencia que pide confirmación", variante: "primaria" }],
    };
  }
  if (estado.paso === "llamada_estandar") {
    return {
      kicker: "El reto de siempre",
      titulo: "En muchos bancos, ahora sonarían",
      parrafos: [
        "Una llamada para leer un código. Si esa vía no te sirve, no tienes que completarla ni explicar por qué.",
        "Al decirlo, pasamos al canal que sí puedes usar. Sola.",
      ],
      acciones: [{ id: "no_puedo", etiqueta: "Esta llamada no me sirve", variante: "primaria" }],
    };
  }
  if (estado.paso === "escrito") {
    return {
      kicker: "Canal elegido por ti",
      titulo: "Pasos escritos, sin llamada",
      parrafos: [
        "La llamada queda fuera. No está entre tus preferencias y no te pedimos el motivo.",
        "Tu último pago habitual fue al Hotel Sol Andino. El código de abajo se lee, no se escucha. Lo confirmas tú.",
      ],
      acciones: [],
    };
  }
  return {
    kicker: "Sin un tercero",
    titulo: "Lista, y lo hiciste sola",
    parrafos: [
      "S/ 2,200 a Taller Rojas pueden seguir. El reto se completó por escrito, que es lo que habías pedido.",
      "Nadie más tuvo que estar presente ni aprobar por ti.",
    ],
    acciones: [{ id: "repetir", etiqueta: "Repetir este recorrido", variante: "secundaria" }],
  };
}
