"use client";

import { useCallback, useEffect, useState } from "react";
import type { Caso, DecisionAccion, ReglaPolicy } from "@/lib/contracts";
import type { JuegoVivo, VistaBanda } from "@/lib/juego/salas";
import { api, post } from "@/components/juego/api";
import { tokenOperador } from "@/components/demo-dashboard";
import { SENALES, TACTICAS, explicar, retiene, soles } from "@/components/juego/datos";
import { PAISES } from "@/components/juego2d/paises";
import { TICKETS } from "@/components/juego2d/pausaOPasa";
import { mazo } from "@/components/juego2d/realOEstafa";
import QRCode from "qrcode";
import s from "./monitor.module.css";

/**
 * `/monitor` — pantalla proyectada (DEMO_JUEGO §5). Lee la API cada 1.5 s.
 * No decide nada: muestra lo que el motor registró, con su regla y su cita.
 */

type ResumenCaso = {
  id: string;
  puerta: "transferencia" | "alerta_aml";
  alias: string | null;
  t: string | null;
  origen: string;
  destino: string;
  monto: number;
  score: number;
  senales: string[];
  decision: { accion: DecisionAccion; regla: ReglaPolicy } | null;
  pausa_preventiva: boolean;
  resuelto_por_memoria: boolean;
  esperando_cliente: boolean;
  llamadas_ia: number;
  actores: string[];
};

type Stats = {
  transacciones_evaluadas: number;
  llamadas_de_ia_totales: number;
  mulas_en_memoria: number;
  nota_datos: string;
  metricas: { eficiencia_ia: { casos_resueltos_sin_ia: number } };
};

type Pct = { n: number; pct: number | null };
type Resumen = {
  victima: {
    n: number;
    h3_cayeron_ronda_a: Pct;
    e3_perdieron_ronda_b: Pct;
    frustracion_ronda_a: { mediana: number | null };
    friccion_pausa_molesto: Record<"no" | "un_poco" | "mucho", number>;
    h5_activaria: { pct_si: number | null };
  };
  atacante: {
    n: number;
    intentos: number;
    frenados: number;
    logrados: number;
    h8_frenados_por_memoria: number;
    por_tactica: Record<string, { intentos: number; logrados: number }>;
    ideas_red_team: number;
  };
  limites: string[];
};

type Health = { agentes: "claude" | "ollama" | "simulado" };

const NODOS = [
  { id: "reglas", icono: "📏", nombre: "Reglas" },
  { id: "pausa", icono: "⏸️", nombre: "Pausa" },
  { id: "memoria", icono: "🧠", nombre: "Memoria" },
  { id: "coordinador", icono: "🧭", nombre: "Coordinador" },
  { id: "guardian", icono: "🛡️", nombre: "Guardián" },
  { id: "detective", icono: "🔍", nombre: "Detective" },
  { id: "policy", icono: "⚖️", nombre: "Policy" },
  { id: "auditor", icono: "📋", nombre: "Auditor" },
] as const;

const EVENTOS: Record<string, string> = {
  caso_creado: "Caso creado",
  alerta_recibida: "Alerta AML recibida",
  nivel0_evaluado: "Reglas evaluaron las señales",
  pausa_preventiva: "Dinero retenido antes de cualquier IA",
  mula_confirmada: "Memoria: cuenta ya confirmada como mula",
  atajo_determinista: "Atajo determinista (sin IA)",
  plan: "Coordinador decidió a quién llamar",
  riesgo_destino: "Detective evaluó la cuenta destino",
  pregunta: "Guardián preguntó al cliente",
  turno_pendiente: "Esperando la respuesta del cliente",
  respuesta_guardian: "Respondió el cliente",
  estado_usuario: "Guardián evaluó la situación del cliente",
  expediente: "Auditor armó el expediente",
  decision: "Policy decidió",
  veredicto: "Veredicto del analista",
  movimiento_registrado: "El dinero se movió",
  consistencia_aplicada: "Control de consistencia aplicado",
  error_agentes: "Modo seguro: un agente falló",
};

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);
const hora = (t: string | null) =>
  t ? new Date(t).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

function encendidos(r: ResumenCaso): Set<string> {
  const on = new Set<string>(["reglas"]);
  if (r.pausa_preventiva) on.add("pausa");
  for (const a of r.actores) on.add(a);
  if (r.decision) on.add("policy");
  return on;
}

/** Orden real del pipeline (doc 19 §1): Guardián ∥ Detective se encienden juntos. */
const ORDEN: Record<string, number> = {
  reglas: 0,
  pausa: 1,
  memoria: 2,
  coordinador: 3,
  guardian: 4,
  detective: 4,
  policy: 5,
  auditor: 6,
};

function Chip({ decision }: { decision: ResumenCaso["decision"] }) {
  if (!decision) return <span className={`${s.chip} ${s.chipNeutro}`}>analizando…</span>;
  const r = retiene(decision.accion);
  return (
    <span className={`${s.chip} ${r ? s.chipRetenido : s.chipPaso}`}>
      {r ? "⏸️" : "→"} {decision.accion} · {decision.regla}
    </span>
  );
}

type NotaCuenta = { id: string; cuenta: string; texto: string; caso: string | null; revisada_en: string | null };
type RespuestaNota = { activa: false; motivo: string } | { activa: true; cuenta: string; nota: NotaCuenta | null };
const LARGO_NOTA = 280;

/**
 * Nota de revisión del analista sobre la cuenta destino, en Atomic Memory.
 * Contexto para el próximo caso de la misma cuenta: no es evidencia, no entra
 * al expediente y no cambia la decisión. Solo la ve el operador con token; si
 * no está configurada, no se muestra nada.
 */
function NotaRevision({ casoId, cuenta }: { casoId: string; cuenta: string }) {
  const [estado, setEstado] = useState<RespuestaNota | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const url = `/api/cases/${casoId}/nota`;

  const cargar = useCallback(async () => {
    try {
      setEstado(await api<RespuestaNota>(url));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar la nota.");
    }
  }, [url]);

  useEffect(() => {
    // Sin token es un visitante del proyector: ni se consulta.
    if (!tokenOperador()) return;
    // El monitor salta de caso en caso: solo se consulta el que queda en pantalla.
    const id = window.setTimeout(() => void cargar(), 400);
    return () => window.clearTimeout(id);
  }, [cargar]);

  if (estado?.activa === false || (!estado && !error)) return null;
  const nota = estado?.activa ? estado.nota : null;

  async function guardar() {
    if (borrador === null) return;
    setEnviando(true);
    setMensaje(null);
    try {
      const r = await api<{ nota: NotaCuenta }>(url, { method: "PUT", body: JSON.stringify({ texto: borrador }) });
      setEstado({ activa: true, cuenta, nota: r.nota });
      setBorrador(null);
      setMensaje(nota ? "Nota corregida en Atomic Memory." : "Nota guardada en Atomic Memory.");
    } catch (e) {
      // El borrador se conserva: nada se dio por guardado.
      setMensaje(e instanceof Error ? e.message : "No se guardó la nota.");
    } finally {
      setEnviando(false);
    }
  }

  async function borrar() {
    if (!window.confirm(`¿Borrar la nota de ${cuenta}? Ningún caso futuro la verá.`)) return;
    setEnviando(true);
    setMensaje(null);
    try {
      await api(url, { method: "DELETE" });
      setEstado({ activa: true, cuenta, nota: null });
      setMensaje("Nota borrada de Atomic Memory.");
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "No se borró la nota.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className={`${s.panel} ${s.notaRevision}`} aria-label={`Nota de revisión de ${cuenta}`}>
      <h2>📝 Nota de revisión · {cuenta} · Atomic Memory</h2>
      {error ? (
        <div className={s.acciones}>
          <p className={s.vacio} role="alert">
            {error} La decisión no depende de esta nota.
          </p>
          <button className={s.boton} onClick={() => void cargar()}>
            Reintentar
          </button>
        </div>
      ) : borrador !== null ? (
        <>
          <textarea
            className={s.campo}
            value={borrador}
            maxLength={LARGO_NOTA}
            rows={3}
            autoFocus
            aria-label={`Nota sobre ${cuenta}`}
            placeholder="Qué revisaste de esta cuenta y qué debería mirar el próximo analista."
            onChange={(e) => setBorrador(e.target.value)}
          />
          <p className={s.nota}>
            {borrador.length}/{LARGO_NOTA} · Solo hechos de la cuenta, sin datos del cliente.
          </p>
          <div className={s.acciones}>
            <button className={`${s.boton} ${s.botonVerde}`} disabled={enviando || !borrador.trim()} onClick={() => void guardar()}>
              {nota ? "Guardar corrección" : "Guardar nota"}
            </button>
            <button className={s.boton} disabled={enviando} onClick={() => setBorrador(null)}>
              Cancelar
            </button>
          </div>
        </>
      ) : nota ? (
        <>
          <p className={s.notaTexto}>«{nota.texto}»</p>
          <p className={s.nota}>
            {[
              "Revisada",
              nota.caso && `en ${nota.caso}`,
              nota.revisada_en &&
                `· ${new Date(nota.revisada_en).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}`,
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
          <div className={s.acciones}>
            <button className={s.boton} disabled={enviando} onClick={() => setBorrador(nota.texto)}>
              ✏️ Corregir
            </button>
            <button className={s.boton} disabled={enviando} onClick={() => void borrar()}>
              🗑 Borrar
            </button>
          </div>
        </>
      ) : (
        <div className={s.acciones}>
          <p className={s.vacio}>Ningún analista dejó una nota sobre {cuenta}.</p>
          <button className={s.boton} onClick={() => setBorrador("")}>
            ＋ Agregar nota
          </button>
        </div>
      )}
      <p className={s.nota}>Contexto para el próximo analista: no es evidencia ni cambia la decisión.</p>
      {mensaje && (
        <p className={s.nota} role="status">
          {mensaje}
        </p>
      )}
    </section>
  );
}

function Detalle({ resumen, caso, onVeredicto }: {
  resumen: ResumenCaso;
  caso: Caso | null;
  onVeredicto: (v: "mula_confirmada" | "descartada") => Promise<void>;
}) {
  const [cita, setCita] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [registrado, setRegistrado] = useState(false);
  const on = encendidos(resumen);
  const firma = `${resumen.id}-${[...on].join(",")}`;
  const auditor = caso?.salidas.auditor;
  const yaVeredicto = registrado || caso?.timeline.some((e) => e.evento === "veredicto");

  return (
    <>
      <section className={s.panel}>
        <h2>
          Caso {resumen.id} · {resumen.alias ?? "demo"} · {resumen.origen} → {resumen.destino}
          {resumen.puerta === "transferencia" ? ` · ${soles(resumen.monto)}` : " · alerta AML"}
        </h2>
        <div className={s.pipeline} key={firma}>
          {NODOS.map((n) => {
            const activo = on.has(n.id);
            return (
              <div
                key={n.id}
                className={`${s.nodo} ${activo ? s.nodoActivo : ""}`}
                style={activo ? { animationDelay: `${ORDEN[n.id] * 350}ms` } : undefined}
              >
                <strong aria-hidden="true">{n.icono}</strong>
                {n.nombre}
              </div>
            );
          })}
        </div>
        {resumen.decision && (
          <div className={`${s.decision} ${retiene(resumen.decision.accion) ? s.decisionRetenido : s.decisionPaso}`}>
            <strong>
              {explicar(resumen.decision.regla).titulo} · {resumen.decision.regla}
            </strong>
            <span>{explicar(resumen.decision.regla).detalle}</span>
            {resumen.resuelto_por_memoria && <span className={s.ceroIA}>⚡ 0 llamadas de IA</span>}
            {!resumen.resuelto_por_memoria && (
              <span className={s.nota}>
                {resumen.llamadas_ia} llamada(s) de IA · señales:{" "}
                {resumen.senales.map((x) => SENALES[x] ?? x).join(", ") || "ninguna"}
              </span>
            )}
          </div>
        )}
        {resumen.esperando_cliente && (
          <p className={s.nota}>🛡️ El Guardián espera la respuesta del cliente. El dinero ya está retenido.</p>
        )}
      </section>

      <div className={s.columnas}>
        <section className={s.panel}>
          <h2>Línea de tiempo</h2>
          {caso ? (
            <ul className={s.lista}>
              {caso.timeline
                .filter((e) => e.evento in EVENTOS)
                .map((e, i) => (
                  <li key={`${e.t}-${i}`}>
                    <span className={s.hora}>{hora(e.t)}</span>
                    <span>{EVENTOS[e.evento]}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className={s.vacio}>Cargando…</p>
          )}
        </section>

        <section className={s.panel}>
          <h2>Expediente</h2>
          {auditor ? (
            <>
              <p style={{ margin: 0 }}>
                Recomendación: <strong>{auditor.recomendacion}</strong>
              </p>
              <ul className={s.lista}>
                {auditor.afirmaciones.map((a, i) => (
                  <li key={i} style={{ display: "block" }}>
                    {a.texto}
                    {a.evidencia.map((id) => (
                      <button key={id} className={s.cita} onClick={() => setCita(id === cita ? null : id)}>
                        {id}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
              {cita && caso && (
                <div className={`${s.evidencia} ${s.evidenciaActiva}`}>
                  <strong>{cita}</strong> · {caso.evidencia.find((e) => e.id === cita)?.fuente ?? "no encontrada"}
                  <br />
                  {JSON.stringify(caso.evidencia.find((e) => e.id === cita)?.dato ?? null)}
                </div>
              )}
              {resumen.destino.startsWith("M-") && !yaVeredicto && (
                <div className={s.acciones}>
                  <button
                    className={`${s.boton} ${s.botonVerde}`}
                    disabled={enviando}
                    onClick={async () => {
                      setEnviando(true);
                      setMensaje(null);
                      try {
                        await onVeredicto("mula_confirmada");
                        setRegistrado(true);
                        setMensaje(`${resumen.destino} entró a la Memoria. El próximo intento cae al instante, sin IA.`);
                      } catch (e) {
                        setMensaje(e instanceof Error ? e.message : "No se pudo registrar.");
                      } finally {
                        setEnviando(false);
                      }
                    }}
                  >
                    ✅ Confirmar mula
                  </button>
                  <button
                    className={s.boton}
                    disabled={enviando}
                    onClick={async () => {
                      setEnviando(true);
                      try {
                        await onVeredicto("descartada");
                        setRegistrado(true);
                        setMensaje("Descartada: la cuenta no entra a la Memoria.");
                      } catch (e) {
                        setMensaje(e instanceof Error ? e.message : "No se pudo registrar.");
                      } finally {
                        setEnviando(false);
                      }
                    }}
                  >
                    ✖ Descartar
                  </button>
                </div>
              )}
              <p className={s.nota}>
                El veredicto lo da un <strong>analista de simulación</strong>, no una revisión humana real.
              </p>
              {mensaje && <p style={{ margin: 0 }}>{mensaje}</p>}
            </>
          ) : (
            <p className={s.vacio}>
              {resumen.resuelto_por_memoria
                ? "No hizo falta: la Memoria ya tenía el veredicto."
                : resumen.decision && !retiene(resumen.decision.accion)
                  ? "Operación permitida: sin expediente."
                  : "El Auditor está armando el expediente…"}
            </p>
          )}
        </section>
      </div>

      <NotaRevision casoId={resumen.id} cuenta={resumen.destino} />
    </>
  );
}

type Arcade = {
  jugadas: number;
  jugadores: number;
  por_pais: Record<string, number>;
  ranking: Record<string, Array<{ alias: string; pais: string; puntaje: number }>>;
  general: Array<{ alias: string; pais: string; puntaje: number }>;
  por_modo: Record<string, number>;
  pausa_o_pasa: { riesgosas_pasadas_pct: number | null; legitimas_pausadas_pct: number | null };
  caidas: Array<{ categoria: string; vistas: number; cayeron: number; pct: number }>;
  reales_rechazados_pct: number | null;
  encuesta: Record<string, Record<string, number>>;
};

const NOMBRE_MODO: Record<string, string> = {
  real_o_estafa: "¿Real o estafa?",
  atrapa_la_mula: "Atrapa la mula",
  pausa_o_pasa: "¿Pausa o pasa?",
  sigue_el_dinero: "Sigue el dinero",
};

const BANDERAS: Record<string, string> = { pe: "🇵🇪", co: "🇨🇴", mx: "🇲🇽", ar: "🇦🇷" };

const CATEGORIAS: Record<string, string> = {
  link_falso: "Link falso",
  falso_banco: "Falso banco",
  falso_familiar: "Falso familiar",
  comprobante_falso: "Comprobante falso",
  premio_falso: "Premio falso",
  empleo_falso: "Trabajo falso",
  inversion_falsa: "Inversión milagro",
  prestamo_falso: "Préstamo falso",
  marketplace: "Comprador falso",
  robo_cuenta: "Código de WhatsApp",
  extorsion: "Extorsión",
  soporte_falso: "Falso soporte",
  romance: "Amor por internet",
};

/** Porcentaje de respuestas de una pregunta que cumplen `ok`. */
function cuota(r: Record<string, number> | undefined, ok: (k: string) => boolean): { pct: number | null; n: number } {
  const n = Object.values(r ?? {}).reduce((a, b) => a + b, 0);
  if (n === 0) return { pct: null, n };
  const si = Object.entries(r ?? {}).reduce((a, [k, v]) => a + (ok(k) ? v : 0), 0);
  return { pct: Math.round((si / n) * 100), n };
}

/** QR como imagen (para escanear desde el proyector). */
function Qr({ texto, tam }: { texto: string; tam: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(texto, { margin: 1, width: tam * 2, errorCorrectionLevel: "M" })
      .then((u) => vivo && setUrl(u))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [texto, tam]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} width={tam} height={tam} alt={`Código QR: ${texto}`} className={s.qr} /> : null;
}

type SalaVivo = {
  codigo: string;
  juego: JuegoVivo;
  host: string;
  fase: string;
  ronda: number;
  rondas: number;
  restante_ms: number | null;
  carta: string | null;
  verdad: boolean | null;
  reparto: { estafa: number; real: number; sin_responder: number } | null;
  respondieron: number;
  jugadores: Array<{ alias: string; pais: string; puntaje: number }>;
  banda: VistaBanda | null;
};

const NOMBRE_SALA: Record<JuegoVivo, string> = {
  real_o_estafa: "¿Real o estafa?",
  pausa_o_pasa: "¿Pausa o pasa?",
  banda: "LA BANDA (atacan de verdad)",
};

const TACTICA: Record<string, string> = {
  falso_banco: "Falso banco",
  link_falso: "Link falso",
  falso_familiar: "Falso familiar",
  app_falsa: "App falsa",
  duplicado_chip: "Duplicado de chip",
};

const VICTIMA: Record<string, string> = { rosa: "Rosa", jorge: "Jorge", lucia: "Lucía" };

/**
 * Los golpes de una sala de LA BANDA: son casos reales del pipeline, así que
 * esto es lo que demuestra el producto en el proyector.
 */
function GolpesEnVivo({ banda }: { banda: VistaBanda }) {
  return (
    <>
      <p className={s.salaReparto}>
        {banda.golpes} golpe(s) · <strong>{banda.frenados} frenados</strong> ·{" "}
        {banda.huecos === 0 ? "ningún hueco" : `${banda.huecos} hueco(s)`}
      </p>
      {banda.ultimos.length > 0 && (
        <ul className={s.lista}>
          {banda.ultimos.slice(0, 5).map((g) => (
            <li key={`${g.caso}-${g.orden}`}>
              <span>{g.frenado ? "🛑" : "⚠️"}</span>
              <span>
                {g.alias} · {TACTICA[g.tactica] ?? g.tactica} → {VICTIMA[g.victima] ?? g.victima} · {soles(g.monto)} ·{" "}
                {g.frenado ? `${g.accion} (${g.regla})` : "PASÓ"} · IA {g.llamadas_ia}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const CARTAS_PE = mazo(PAISES.pe);

function textoCarta(sala: SalaVivo): string {
  if (!sala.carta) return "";
  if (sala.juego === "pausa_o_pasa") {
    const t = TICKETS.find((x) => x.id === sala.carta);
    return t ? `A: ${t.destino} · ${t.senales.map((x) => x.texto).join(" · ")}` : sala.carta;
  }
  const c = CARTAS_PE.find((x) => x.id === sala.carta);
  return c ? `${c.canal} · ${c.de}: «${c.texto}»` : sala.carta;
}

const FASE_SALA: Record<string, string> = {
  espera: "En espera",
  ataque: "Atacando",
  cuenta: "Empieza…",
  responder: "Respondiendo",
  revelar: "Respuesta",
  fin: "Terminó",
};

/** Salas EN VIVO, para proyectar: la carta, cómo respondió la sala y el top. */
function PanelSalas({ salas }: { salas: SalaVivo[] }) {
  const vivas = salas.filter((x) => x.fase !== "fin" || x.jugadores.some((j) => j.puntaje > 0)).slice(0, 2);
  if (vivas.length === 0) return null;
  return (
    <section className={s.panel}>
      <h2>🔴 Salas en vivo</h2>
      {vivas.map((sala) => {
        const enlace = `${window.location.origin}/play?sala=${sala.codigo}`;
        const r = sala.reparto;
        const tot = r ? Math.max(1, r.estafa + r.real + r.sin_responder) : 1;
        const [a, b] = sala.juego === "pausa_o_pasa" ? ["Pausa", "Pasa"] : ["Estafa", "Real"];
        return (
          <div key={sala.codigo} className={s.sala}>
            {sala.fase === "espera" && (
              <div className={s.salaQr}>
                <Qr texto={enlace} tam={120} />
                <p>
                  Escanea para entrar a la sala <strong>{sala.codigo}</strong>
                </p>
              </div>
            )}
            <p className={s.salaCabecera}>
              <strong>{sala.codigo}</strong> · {NOMBRE_SALA[sala.juego] ?? sala.juego} · {FASE_SALA[sala.fase] ?? sala.fase}
              {sala.fase === "responder" || sala.fase === "revelar" ? ` · ronda ${sala.ronda + 1}/${sala.rondas}` : ""} · {sala.jugadores.length} jugando
            </p>
            {sala.banda ? (
              <GolpesEnVivo banda={sala.banda} />
            ) : (
              sala.carta && <p className={s.salaCarta}>{textoCarta(sala)}</p>
            )}
            {sala.fase === "responder" && (
              <p className={s.nota}>
                Respondieron {sala.respondieron}/{sala.jugadores.length}
              </p>
            )}
            {r && !sala.banda && (
              <p className={s.salaReparto}>
                {sala.verdad ? "✅ Era " + (sala.juego === "pausa_o_pasa" ? "para pausar" : "estafa") : "✅ Era " + (sala.juego === "pausa_o_pasa" ? "para dejar pasar" : "real")} · {a}{" "}
                {Math.round((r.estafa / tot) * 100)}% · {b} {Math.round((r.real / tot) * 100)}% · sin responder {r.sin_responder}
              </p>
            )}
            <ul className={s.lista}>
              {sala.jugadores.slice(0, 5).map((j, i) => (
                <li key={j.alias}>
                  <span>#{i + 1}</span>
                  <span>
                    {BANDERAS[j.pais] ?? ""} {j.alias} · {j.puntaje}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

type Carga = {
  agentes: "claude" | "ollama" | "simulado";
  modelo: {
    concurrencia: number;
    en_curso: number;
    en_cola: number;
    atendidas: number;
    saturadas: number;
    por_circuito: number;
    circuito: "cerrado" | "abierto" | "probando";
    latencia_ms: { p50: number | null; p95: number | null };
    ultimo_minuto: { con_ia: number; degradadas: number };
  } | null;
  proceso: { memoria_mb: number; lag_ms: number };
  ola: {
    activa: boolean;
    lanzados: number;
    objetivo: number;
    completados: number;
    errores: number;
    a_mulas: number;
    mulas_retenidas: number;
    legitimos: number;
    legitimos_pasaron: number;
    casos_con_ia: number;
    latencia_ms: { p50: number | null; p95: number | null };
  };
};

const CIRCUITO: Record<string, string> = { cerrado: "🟢 normal", abierto: "🔴 abierto: reglas + memoria", probando: "🟡 probando" };

/** Resistencia bajo carga: la ola de ataques y cómo responde el modelo. */
function PanelResistencia({ c, onOla }: { c: Carga | null; onOla: (n: number | null) => void }) {
  if (!c) return null;
  const o = c.ola;
  const m = c.modelo;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const min = m?.ultimo_minuto;
  const totalMin = min ? min.con_ia + min.degradadas : 0;
  return (
    <section className={s.panel}>
      <h2>🛡️ Resistencia bajo carga</h2>
      <div className={s.marcador}>
        <div className={`${s.kpi} ${s.kpiAncho}`}>
          <span>Ola de ataques {o.activa ? "· EN CURSO" : ""}</span>
          <strong>
            {o.completados}/{o.objetivo || o.lanzados} · errores {o.errores}
          </strong>
        </div>
        <div className={s.kpi}>
          <span>Ataques a mulas retenidos</span>
          <strong>{pct(o.mulas_retenidas, o.a_mulas)}</strong>
        </div>
        <div className={s.kpi}>
          <span>Pagos legítimos que pasaron</span>
          <strong>{pct(o.legitimos_pasaron, o.legitimos)}</strong>
        </div>
        <div className={s.kpi}>
          <span>Modelo ({c.agentes})</span>
          <strong>{m ? `${m.en_curso}/${m.concurrencia} · cola ${m.en_cola}` : "sin modelo"}</strong>
        </div>
        <div className={s.kpi}>
          <span>Cortacircuitos</span>
          <strong className={s.circuito}>{m ? CIRCUITO[m.circuito] : "—"}</strong>
        </div>
        <div className={`${s.kpi} ${s.kpiAncho}`}>
          <span>Último minuto: con IA vs. modo degradado (reglas + memoria)</span>
          <strong>
            {min ? `${min.con_ia} · ${min.degradadas}` : "—"}
            {totalMin > 0 && (
              <span className={s.barraCarga}>
                <span style={{ width: `${(100 * (min?.con_ia ?? 0)) / totalMin}%` }} />
              </span>
            )}
          </strong>
        </div>
        <div className={s.kpi}>
          <span>Latencia p95 por ataque</span>
          <strong>{o.latencia_ms.p95 === null ? "—" : `${(o.latencia_ms.p95 / 1000).toFixed(1)} s`}</strong>
        </div>
        <div className={s.kpi}>
          <span>Servidor: retardo · memoria</span>
          <strong>
            {c.proceso.lag_ms} ms · {c.proceso.memoria_mb} MB
          </strong>
        </div>
      </div>
      <div className={s.acciones}>
        <button className={s.boton} onClick={() => onOla(200)} disabled={o.activa}>
          🔥 Ola: 200 ataques
        </button>
        <button className={s.boton} onClick={() => onOla(500)} disabled={o.activa}>
          🌊 Ola grande: 500
        </button>
        {o.activa && (
          <button className={s.boton} onClick={() => onOla(null)}>
            ⏹ Parar
          </button>
        )}
      </div>
      <p className={s.nota}>
        Si el modelo se satura, el caso se decide igual con reglas + memoria: el dinero sigue retenido. Lo que pasa es el
        hueco conocido (montos chicos a cuentas nuevas sin señales), igual con o sin carga.
      </p>
    </section>
  );
}

function PanelTraccion({ a }: { a: Arcade | null }) {
  if (!a) return null;
  const vivido = cuota(a.encuesta.vivido, (k) => k !== "no");
  const activaria = cuota(a.encuesta.activaria, (k) => k === "si");
  const protege = cuota(a.encuesta.protege_hoy, (k) => k === "no");
  const espera = cuota(a.encuesta.espera, (k) => k !== "nada");
  const recomienda = cuota(a.encuesta.recomendaria, (k) => k === "si");
  const v = (c: { pct: number | null; n: number }) => (c.pct === null ? "—" : `${c.pct}%`);
  return (
    <section className={s.panel}>
      <h2>Tracción y encuesta (arcade)</h2>
      <div className={s.marcador}>
        <div className={s.kpi}>
          <span>Jugadores</span>
          <strong>{a.jugadores}</strong>
        </div>
        <div className={s.kpi}>
          <span>Partidas</span>
          <strong>{a.jugadas}</strong>
        </div>
        <div className={`${s.kpi} ${s.kpiAncho}`}>
          <span>Por país</span>
          <strong>
            {Object.entries(a.por_pais)
              .map(([k, n]) => `${BANDERAS[k] ?? k} ${n}`)
              .join("  ") || "—"}
          </strong>
        </div>
        <div className={s.kpi}>
          <span>Les pasó (a ellos o alguien cercano) · n={vivido.n}</span>
          <strong>{v(vivido)}</strong>
        </div>
        <div className={s.kpi}>
          <span>Su banco hoy NO los protege · n={protege.n}</span>
          <strong>{v(protege)}</strong>
        </div>
        <div className={s.kpi}>
          <span>Esperarían una pausa · n={espera.n}</span>
          <strong>{v(espera)}</strong>
        </div>
        <div className={s.kpi}>
          <span>Activarían la capa · n={activaria.n}</span>
          <strong>{v(activaria)}</strong>
        </div>
        <div className={s.kpi}>
          <span>Lo pasarían a un familiar · n={recomienda.n}</span>
          <strong>{v(recomienda)}</strong>
        </div>
        <div className={s.kpi}>
          <span>Mensajes reales marcados como estafa</span>
          <strong>{a.reales_rechazados_pct === null ? "—" : `${a.reales_rechazados_pct}%`}</strong>
        </div>
        <div className={s.kpi}>
          <span>¿PAUSA O PASA?: dejaron pasar un robo</span>
          <strong>{a.pausa_o_pasa?.riesgosas_pasadas_pct == null ? "—" : `${a.pausa_o_pasa.riesgosas_pasadas_pct}%`}</strong>
        </div>
        <div className={s.kpi}>
          <span>¿PAUSA O PASA?: pausaron un pago normal</span>
          <strong>{a.pausa_o_pasa?.legitimas_pausadas_pct == null ? "—" : `${a.pausa_o_pasa.legitimas_pausadas_pct}%`}</strong>
        </div>
        <div className={`${s.kpi} ${s.kpiAncho}`}>
          <span>Partidas por juego</span>
          <strong>
            {Object.entries(a.por_modo ?? {})
              .map(([k, n]) => `${NOMBRE_MODO[k] ?? k} ${n}`)
              .join(" · ") || "—"}
          </strong>
        </div>
      </div>
      {a.caidas.length > 0 && (
        <>
          <p className={s.nota}>¿En qué estafa cae más la gente? (¿REAL O ESTAFA?)</p>
          <ul className={s.lista}>
            {a.caidas.slice(0, 6).map((c) => (
              <li key={c.categoria}>
                <span>{c.pct}%</span>
                <span>
                  {CATEGORIAS[c.categoria] ?? c.categoria} · {c.cayeron}/{c.vistas}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {(["general", "real_o_estafa", "atrapa_la_mula", "pausa_o_pasa", "sigue_el_dinero"] as const).map((modo) =>
        (modo === "general" ? a.general : a.ranking[modo])?.length ? (
          <div key={modo}>
            <p className={s.nota}>🏆 {modo === "general" ? "RANKING GENERAL" : NOMBRE_MODO[modo]}</p>
            <ul className={s.lista}>
              {(modo === "general" ? a.general : a.ranking[modo]).slice(0, modo === "general" ? 5 : 3).map((f, i) => (
                <li key={f.alias}>
                  <span>#{i + 1}</span>
                  <span>
                    {BANDERAS[f.pais] ?? ""} {f.alias} · {f.puntaje}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </section>
  );
}

export default function Monitor() {
  const [casos, setCasos] = useState<ResumenCaso[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [arcade, setArcade] = useState<Arcade | null>(null);
  const [salasVivas, setSalasVivas] = useState<SalaVivo[]>([]);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [fijo, setFijo] = useState(false);
  const [detalle, setDetalle] = useState<Caso | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origen, setOrigen] = useState("");

  useEffect(() => setOrigen(window.location.host), []);

  const actual = casos.find((c) => c.id === seleccion) ?? casos[0] ?? null;

  const refrescar = useCallback(async () => {
    try {
      const [c, st, r] = await Promise.all([
        api<{ total: number; casos: ResumenCaso[] }>("/api/cases?limite=100"),
        api<Stats>("/api/stats"),
        api<Resumen>("/api/juego/resumen"),
      ]);
      setCasos(c.casos);
      setTotal(c.total);
      setStats(st);
      setResumen(r);
      setError(null);
      api<Arcade>("/api/juego/arcade").then(setArcade).catch(() => undefined);
      api<Carga>("/api/carga")
        .then(setCarga)
        .catch(() => undefined);
      api<{ salas: SalaVivo[] }>("/api/juego/salas")
        .then((x) => setSalasVivas(x.salas))
        .catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? `Sin conexión con el sistema: ${e.message}` : "Sin conexión con el sistema.");
    }
  }, []);

  useEffect(() => {
    void refrescar();
    api<Health>("/api/health").then(setHealth).catch(() => undefined);
    const id = window.setInterval(() => void refrescar(), 1500);
    return () => window.clearInterval(id);
  }, [refrescar]);

  // Sin selección fija, el monitor sigue al caso más nuevo.
  useEffect(() => {
    if (!fijo && casos[0] && casos[0].id !== seleccion) setSeleccion(casos[0].id);
  }, [casos, fijo, seleccion]);

  const idActual = actual?.id;
  const firmaActual = actual ? `${actual.id}-${actual.decision?.regla}-${actual.actores.length}` : "";
  useEffect(() => {
    if (!idActual) {
      setDetalle(null);
      return;
    }
    api<Caso>(`/api/cases/${idActual}`).then(setDetalle).catch(() => setDetalle(null));
  }, [idActual, firmaActual]);

  const transferencias = casos.filter((c) => c.puerta === "transferencia" && c.decision);
  const retenidas = transferencias.filter((c) => retiene(c.decision!.accion));
  const importeRetenido = retenidas.reduce((acc, c) => acc + c.monto, 0);
  const iaPorIntento =
    stats && stats.transacciones_evaluadas > 0
      ? (stats.llamadas_de_ia_totales / stats.transacciones_evaluadas).toFixed(1)
      : "—";

  async function veredicto(v: "mula_confirmada" | "descartada") {
    if (!actual) return;
    await post(`/api/cases/${actual.id}/verdict`, { veredicto: v, validado_por: "analista_simulacion" });
    await refrescar();
  }

  async function alertaM01() {
    try {
      const c = await post<Caso>("/api/alerts", { cuenta: "M-01", motivo: "fan-in con reenvío rápido" });
      setFijo(false);
      setSeleccion(c.id);
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo lanzar la alerta.");
    }
  }

  // La ola se ve en el feed mientras dura; después no tapa a los jugadores reales.
  const feed = carga?.ola.activa ? casos : casos.filter((c) => c.alias !== "OLA");

  async function lanzarOla(n: number | null) {
    try {
      if (n === null) await post("/api/carga", { accion: "parar" });
      else {
        if (!window.confirm(`¿Lanzar ${n} ataques contra el sistema? Aparecen en el feed como «OLA».`)) return;
        await post("/api/carga", { accion: "lanzar", n, por_segundo: n > 300 ? 40 : 20 });
      }
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo lanzar la ola.");
    }
  }

  async function reiniciar() {
    if (!window.confirm("¿Reiniciar el demo? Se borran los casos y la Memoria (las partidas se conservan).")) return;
    try {
      await post("/api/demo/reset", {});
      setFijo(false);
      setSeleccion(null);
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reiniciar.");
    }
  }

  return (
    <main className={s.pagina}>
      <header className={s.cabecera}>
        <h1 className={s.titulo}>
          Te están robando · <span>Monitor de agentes</span>
        </h1>
        <span className={s.jugar}>
          {origen && <Qr texto={`${window.location.protocol}//${origen}/play`} tam={64} />}
          Juega desde tu celular: <strong>{origen ? `${origen}/play` : "/play"}</strong>
        </span>
        <span className={s.sello}>
          Datos 100% sintéticos · agentes {health?.agentes === "claude" ? "con Claude" : health?.agentes === "ollama" ? "con modelo local" : "simulados"}
        </span>
      </header>

      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      <div className={s.rejilla}>
        <section className={s.panel}>
          <h2>
            Intentos en vivo {total > casos.length ? `(últimos ${casos.length} de ${total})` : `(${total})`}
          </h2>
          {feed.length === 0 ? (
            <p className={s.vacio}>Todavía no hay intentos. Escanea y juega en /play.</p>
          ) : (
            <ul className={s.feed}>
              {feed.map((c) => (
                <li key={c.id}>
                  <button
                    className={s.item}
                    aria-current={c.id === actual?.id}
                    onClick={() => {
                      setFijo(true);
                      setSeleccion(c.id);
                    }}
                  >
                    <span className={s.itemFila}>
                      <span className={s.alias}>⚡ {c.alias ?? (c.puerta === "alerta_aml" ? "Monitoreo AML" : "Demo")}</span>
                      <span className={s.meta}>{hora(c.t)}</span>
                    </span>
                    <span className={s.itemFila}>
                      <span className={s.meta}>
                        {c.origen} → {c.destino}
                        {c.puerta === "transferencia" ? ` · ${soles(c.monto)}` : ""}
                      </span>
                      <Chip decision={c.decision} />
                    </span>
                    {c.resuelto_por_memoria && <span className={`${s.chip} ${s.chipRetenido}`}>⚡ 0 IA · Memoria</span>}
                    {c.esperando_cliente && <span className={`${s.chip} ${s.chipNeutro}`}>🛡️ esperando al cliente</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {fijo && (
            <button className={s.boton} onClick={() => setFijo(false)}>
              Seguir el caso más nuevo
            </button>
          )}
        </section>

        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          {actual ? (
            <Detalle key={actual.id} resumen={actual} caso={detalle} onVeredicto={veredicto} />
          ) : (
            <section className={s.panel}>
              <h2>Agentes</h2>
              <p className={s.vacio}>Cuando llegue un intento, aquí se encienden los agentes en el orden real.</p>
            </section>
          )}
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <PanelSalas salas={salasVivas} />
          <PanelResistencia c={carga} onOla={(n) => void lanzarOla(n)} />
          <section className={s.panel}>
            <h2>Marcador</h2>
            <div className={s.marcador}>
              <div className={s.kpi}>
                <span>Transferencias</span>
                <strong>{transferencias.length}</strong>
              </div>
              <div className={s.kpi}>
                <span>Retenidas</span>
                <strong>{retenidas.length}</strong>
              </div>
              <div className={s.kpi}>
                <span>Pasaron</span>
                <strong>{transferencias.length - retenidas.length}</strong>
              </div>
              <div className={s.kpi}>
                <span>Mulas en memoria</span>
                <strong>{stats?.mulas_en_memoria ?? "—"}</strong>
              </div>
              <div className={`${s.kpi} ${s.kpiAncho}`}>
                <span>Importe sintético retenido</span>
                <strong>{soles(importeRetenido)}</strong>
              </div>
              <div className={s.kpi}>
                <span>IA por intento</span>
                <strong>{iaPorIntento}</strong>
              </div>
              <div className={s.kpi}>
                <span>Resueltos sin IA</span>
                <strong>{stats?.metricas.eficiencia_ia.casos_resueltos_sin_ia ?? "—"}</strong>
              </div>
            </div>
            <p className={s.nota}>«Pasaron» incluye pagos legítimos (p. ej. a Don Pepe). Importe sintético, no dinero ahorrado.</p>
          </section>

          <section className={s.panel}>
            <h2>Experimento en vivo</h2>
            {resumen ? (
              <>
                <div className={s.marcador}>
                  <div className={s.kpi}>
                    <span>Cayeron con aviso genérico</span>
                    <strong>{pct(resumen.victima.h3_cayeron_ronda_a.pct)}</strong>
                  </div>
                  <div className={s.kpi}>
                    <span>Perdieron con la capa</span>
                    <strong>{pct(resumen.victima.e3_perdieron_ronda_b.pct)}</strong>
                  </div>
                  <div className={s.kpi}>
                    <span>Activarían la protección</span>
                    <strong>{pct(resumen.victima.h5_activaria.pct_si)}</strong>
                  </div>
                  <div className={s.kpi}>
                    <span>Frustración (mediana)</span>
                    <strong>
                      {resumen.victima.frustracion_ronda_a.mediana === null
                        ? "—"
                        : ["😌", "🙂", "😐", "😟", "😫"][Math.round(resumen.victima.frustracion_ronda_a.mediana) - 1]}
                    </strong>
                  </div>
                  <div className={`${s.kpi} ${s.kpiAncho}`}>
                    <span>Atacantes: intentos · frenados · huecos · por Memoria</span>
                    <strong>
                      {resumen.atacante.intentos} · {resumen.atacante.frenados} · {resumen.atacante.logrados} ·{" "}
                      {resumen.atacante.h8_frenados_por_memoria}
                    </strong>
                  </div>
                </div>
                {resumen.atacante.intentos > 0 && (
                  <ul className={s.lista}>
                    {TACTICAS.filter((t) => resumen.atacante.por_tactica[t.id]?.intentos).map((t) => (
                      <li key={t.id}>
                        <span>{t.icono}</span>
                        <span>
                          {t.nombre}: {resumen.atacante.por_tactica[t.id].intentos} intentos ·{" "}
                          {resumen.atacante.por_tactica[t.id].logrados} pasaron
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className={s.nota}>
                  n = {resumen.victima.n} víctimas · {resumen.atacante.n} atacantes.{" "}
                  {resumen.limites[0]} {resumen.limites[1]}
                </p>
              </>
            ) : (
              <p className={s.vacio}>Sin partidas todavía.</p>
            )}
          </section>

          <PanelTraccion a={arcade} />

          <section className={s.panel}>
            <h2>Operador</h2>
            <div className={s.acciones}>
              <button className={s.boton} onClick={() => void alertaM01()}>
                🚨 Alerta AML sobre M-01
              </button>
              <button className={s.boton} onClick={() => void reiniciar()}>
                ↺ Reiniciar demo
              </button>
            </div>
            <p className={s.nota}>
              La alerta abre el expediente de M-01; «Confirmar mula» la manda a la Memoria y desde ahí todos los intentos a
              esa cuenta caen al instante.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
