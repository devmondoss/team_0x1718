/**
 * Tipos de la experiencia del titular.
 *
 * La decisión de fondos la toma un motor de reglas. No hay campos de edad,
 * salud ni nivel socioeconómico: el canal se adapta por preferencia declarada
 * y la disponibilidad es una situación, no un atributo de la persona.
 */

export type ModoUsuario =
  | "disponible"
  | "inalcanzable"
  | "dispositivo_comprometido"
  | "canal_alternativo";

/** Hechos que el panel de demo puede marcar. `usuario_inalcanzable` no puntúa. */
export type EventoRiesgo =
  | "beneficiario_nuevo"
  | "monto_anomalo"
  | "dispositivo_nuevo"
  | "acceso_remoto"
  | "usuario_inalcanzable";

export type Salida =
  | "permitir"
  | "reto_adaptativo"
  | "reto_fuera_de_canal"
  | "retencion_protectora"
  | "bloquear_revision";

export type ReglaId = "E0" | "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7" | "E8" | "E10" | "E11" | "E12";

export type NivelRiesgo = "bajo" | "medio" | "alto" | "critico";

export type CanalVerificacion =
  | "ninguno"
  | "app"
  | "app_escrita"
  | "segundo_dispositivo"
  | "presencial";

export type RespuestaEstafa = "guiado" | "pausa" | "salida_segura" | "confirma_igual";

export type EquivalentePolicy = "PERMITIR" | "VERIFICAR" | "PAUSAR" | "ESCALAR";

export interface EntradaMotor {
  modo: ModoUsuario;
  eventos: EventoRiesgo[];
  monto: number;
  beneficiarioHabitual: boolean;
  politicaViajeActiva: boolean;
  umbralViaje: number;
  /** false significa «la voz no me sirve». Preferencia declarada, no un dato de salud. */
  vozDisponible: boolean;
  canalAlternativo: Exclude<CanalVerificacion, "ninguno" | "app">;
  respuestaEstafa: RespuestaEstafa | null;
  verificadoEnCanalSeguro: boolean;
  liberacionExplicita: boolean;
  permitirHabituales: boolean;
  /** Hay otra operación ya retenida. Sirve para la salida de emergencia. */
  hayOtraRetencion: boolean;
}

export interface SenalExplicada {
  id: EventoRiesgo;
  puntos: number;
  texto: string;
}

export interface Decision {
  salida: Salida;
  regla: ReglaId;
  titulo: string;
  motivo: string;
  porqueTitular: string[];
  porqueAnalista: string[];
  canal: CanalVerificacion;
  canalEvitado: string | null;
  canalMotivo: string;
  score: number;
  nivel: NivelRiesgo;
  senales: SenalExplicada[];
  politicaCitada: string | null;
  preguntaEstafa: string | null;
  equivalentePolicy: EquivalentePolicy;
  fondosSalen: boolean;
  silencioEsAprobacion: false;
  iaDecideFondos: false;
}

export interface Operacion {
  id: string;
  destino: string;
  detalle: string;
  monto: number;
  habitual: boolean;
  eventos: EventoRiesgo[];
}

export interface Hecho {
  id: string;
  cuando: string;
  titularTitulo: string;
  titularDetalle: string;
  analistaTitulo: string;
  analistaDetalle: string;
}

export interface Retencion {
  id: string;
  destino: string;
  monto: number;
  estado: "activa" | "cancelada" | "liberada";
}

export interface MovimientoExtra {
  id: string;
  cuando: string;
  concepto: string;
  monto: number;
}
