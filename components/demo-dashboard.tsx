"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Caso, Evidencia, EventoTimeline } from "@/lib/contracts";

type ScenarioId = "rosa" | "alerta" | "jorge" | "bodega" | "lucia";

type Health = {
  ok: boolean;
  agentes: "claude" | "simulado";
  datos: { nota: string };
};

type Stats = {
  transacciones_evaluadas: number;
  sospechosas: number;
  con_llamadas_de_ia: number;
  llamadas_de_ia_totales: number;
  mulas_en_memoria: number;
  por_regla: Record<string, number>;
  metricas: {
    eficiencia_ia: {
      casos_resueltos_sin_ia: number;
      resueltos_por_memoria: number;
      llamadas_evitadas_por_memoria: {
        estimado: number | null;
      };
    };
  };
};

const scenarios: Array<{
  id: ScenarioId;
  act: string;
  title: string;
  description: string;
}> = [
  {
    id: "rosa",
    act: "Acto 1",
    title: "Rosa recibe una llamada",
    description: "Transferencia de S/ 4,800 a un beneficiario nuevo.",
  },
  {
    id: "alerta",
    act: "Acto 2",
    title: "Revisión de M-01",
    description: "El analista recibe el expediente de la cuenta destino.",
  },
  {
    id: "jorge",
    act: "Acto 3",
    title: "Jorge es la siguiente víctima",
    description: "La memoria protege su transferencia sin volver a investigar.",
  },
  {
    id: "bodega",
    act: "Control",
    title: "Bodega Don Pepe",
    description: "Un pago legítimo que el sistema debe permitir.",
  },
  {
    id: "lucia",
    act: "Alterno",
    title: "Dispositivo nuevo de Lucía",
    description: "Una operación que requiere verificación adicional.",
  },
];

const eventNames: Record<string, string> = {
  caso_creado: "Caso creado",
  nivel0_evaluado: "Señales iniciales evaluadas",
  pausa_preventiva: "Pausa preventiva aplicada",
  plan: "Plan de investigación",
  riesgo_destino: "Riesgo de la cuenta evaluado",
  pregunta: "Pregunta enviada al cliente",
  turno_pendiente: "Respuesta del cliente pendiente",
  respuesta_guardian: "Respuesta recibida",
  estado_usuario: "Situación del cliente evaluada",
  expediente: "Expediente preparado",
  decision: "Decisión de política",
  mula_confirmada: "Coincidencia en memoria",
  veredicto: "Veredicto humano registrado",
  atajo_determinista: "Atajo determinista aplicado",
  error_agentes: "Modo seguro activado",
  consistencia_aplicada: "Control de consistencia aplicado",
  presupuesto_excedido: "Límite de llamadas alcanzado",
  alerta_recibida: "Alerta recibida",
};

const actorNames: Record<string, string> = {
  sistema: "Sistema",
  reglas: "Reglas",
  coordinador: "Coordinador",
  guardian: "Guardián",
  detective: "Detective",
  auditor: "Auditor",
  policy: "Policy Engine",
  memoria: "Memoria",
  cliente: "Cliente",
  analista: "Analista",
  monitoreo: "Monitoreo",
};

function detailRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

const CLAVE_TOKEN = "afs-demo-token";
/** Respaldo en memoria de la página si sessionStorage está bloqueado. */
let tokenEnMemoria: string | null = null;

/**
 * Token del operador (solo si el servidor corre con DEMO_TOKEN, p. ej. detrás
 * de un túnel). Se abre la consola con `/?token=…`: primero se QUITA de la URL
 * (para que no quede visible en el proyector) y luego se guarda en la pestaña.
 */
export function tokenOperador(): string | null {
  try {
    const url = new URL(window.location.href);
    const enUrl = url.searchParams.get("token");
    if (enUrl) {
      url.searchParams.delete("token");
      window.history.replaceState(null, "", url.toString());
      tokenEnMemoria = enUrl;
      try {
        window.sessionStorage.setItem(CLAVE_TOKEN, enUrl);
      } catch {
        // almacenamiento bloqueado: queda en memoria mientras dure la página
      }
    }
    try {
      return window.sessionStorage.getItem(CLAVE_TOKEN) ?? tokenEnMemoria;
    } catch {
      return tokenEnMemoria;
    }
  } catch {
    return tokenEnMemoria;
  }
}

/** Solo para tests: olvida el token en memoria. */
export function olvidarTokenOperador(): void {
  tokenEnMemoria = null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const token = tokenOperador();
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "x-demo-token": token } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(body?.error ?? `La solicitud falló (${response.status}).`);
  }
  if (body === null) throw new Error("El servidor devolvió una respuesta vacía.");
  return body;
}

function ShieldMark({ paused = false }: { paused?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="shield-mark"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z" />
      {paused ? (
        <>
          <path d="M9.5 9v6M14.5 9v6" />
        </>
      ) : (
        <path d="m8.5 12 2.2 2.2 4.8-5" />
      )}
    </svg>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    maximumFractionDigits: 0,
  }).format(value);
}

function hasEvent(caso: Caso | null, event: string) {
  return caso?.timeline.some((item) => item.evento === event) ?? false;
}

function eventMessage(event: EventoTimeline): string | null {
  const detail = detailRecord(event.detalle);
  return typeof detail?.mensaje === "string" ? detail.mensaje : null;
}

function ClientPanel({
  caso,
  scenario,
  busy,
  onReply,
}: {
  caso: Caso | null;
  scenario: ScenarioId;
  busy: string | null;
  onReply: (text: string) => Promise<void>;
}) {
  const [reply, setReply] = useState("");
  const protectedFunds = hasEvent(caso, "pausa_preventiva");
  const questions =
    caso?.timeline
      .filter((event) => event.evento === "pregunta")
      .map(eventMessage)
      .filter((message): message is string => Boolean(message)) ?? [];
  const replies =
    caso?.timeline
      .filter((event) => event.evento === "respuesta_guardian")
      .map((event) => {
        const detail = detailRecord(event.detalle);
        return typeof detail?.texto === "string" ? detail.texto : null;
      })
      .filter((text): text is string => text !== null) ?? [];
  const chatPending =
    Boolean(caso) &&
    caso?.puerta === "transferencia" &&
    questions.length > replies.length &&
    !caso.salidas.guardian;

  const messages = questions.flatMap((question, index) => {
    const items: Array<{
      from: "guardian" | "client";
      text: string;
    }> = [{ from: "guardian", text: question }];
    if (replies[index] !== undefined) {
      items.push({
        from: "client" as const,
        text: replies[index] || "No pude responder",
      });
    }
    return items;
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reply.trim()) return;
    await onReply(reply.trim());
    setReply("");
  }

  return (
    <section className="phone-column" aria-labelledby="client-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Vista de la persona</p>
          <h2 id="client-title">App bancaria</h2>
        </div>
        <span className="panel-status">
          <span className="status-dot" />
          Canal seguro
        </span>
      </div>

      <div className="phone-shell">
        <div className="phone-topbar" aria-hidden="true">
          <span>9:41</span>
          <span className="phone-speaker" />
          <span>5G</span>
        </div>
        <div className="phone-content">
          <header className="bank-header">
            <span className="bank-monogram" aria-hidden="true">
              AF
            </span>
            <div>
              <p className="bank-name">Banca segura</p>
              <p className="bank-greeting">
                {scenario === "rosa"
                  ? "Hola, Rosa"
                  : scenario === "jorge" || scenario === "bodega"
                    ? "Hola, Jorge"
                    : "Hola"}
              </p>
            </div>
          </header>

          {!caso ? (
            <div className="phone-empty">
              <ShieldMark />
              <h3>Lista para una transferencia</h3>
              <p>Elige un acto arriba para iniciar la demostración.</p>
            </div>
          ) : caso.puerta === "alerta_aml" ? (
            <div className="phone-empty">
              <ShieldMark />
              <h3>Sin interacción con el cliente</h3>
              <p>Este acto ocurre únicamente en la consola del banco.</p>
            </div>
          ) : (
            <>
              <div className="transfer-summary">
                <p className="subtle-label">Transferencia a</p>
                <strong>{caso.transaccion.destino}</strong>
                <span>{formatMoney(caso.transaccion.monto)}</span>
              </div>

              {protectedFunds ? (
                <div className="protection-card" role="status">
                  <ShieldMark paused />
                  <div>
                    <p className="protection-kicker">Pausa preventiva</p>
                    <h3>Tu dinero está protegido</h3>
                    <p>
                      Detuvimos la transferencia mientras verificamos que estés
                      a salvo.
                    </p>
                  </div>
                </div>
              ) : caso.decision?.accion === "PERMITIR" ? (
                <div className="allowed-card" role="status">
                  <ShieldMark />
                  <div>
                    <h3>Transferencia permitida</h3>
                    <p>La operación pasó los controles de seguridad.</p>
                  </div>
                </div>
              ) : (
                <div className="loading-card" role="status">
                  <Spinner />
                  <p>Revisando la transferencia…</p>
                </div>
              )}

              {(messages.length > 0 || chatPending) && (
                <section className="guardian-chat" aria-labelledby="chat-title">
                  <div className="chat-header">
                    <span className="guardian-mark" aria-hidden="true">
                      G
                    </span>
                    <div>
                      <h3 id="chat-title">Guardián</h3>
                      <p>Verificación de seguridad</p>
                    </div>
                  </div>
                  <div
                    className="chat-messages"
                    aria-live="polite"
                    aria-relevant="additions text"
                  >
                    {messages.map((message, index) => (
                      <p
                        className={`chat-bubble chat-${message.from}`}
                        key={`${message.from}-${index}`}
                      >
                        {message.text}
                      </p>
                    ))}
                    {busy === "reply" && (
                      <p className="chat-bubble chat-guardian">
                        <Spinner /> Revisando tu respuesta…
                      </p>
                    )}
                  </div>

                  {chatPending && busy !== "reply" && (
                    <>
                      <div className="quick-replies" aria-label="Respuestas rápidas">
                        <button type="button" onClick={() => onReply("Sí, el banco")}>
                          Sí, el banco
                        </button>
                        <button type="button" onClick={() => onReply("No conozco a la persona")}>
                          No la conozco
                        </button>
                        <button type="button" onClick={() => onReply("")}>
                          No puedo responder
                        </button>
                      </div>
                      <form className="reply-form" onSubmit={submit}>
                        <label htmlFor="guardian-reply">Escribe tu respuesta</label>
                        <div>
                          <input
                            id="guardian-reply"
                            value={reply}
                            onChange={(event) => setReply(event.target.value)}
                            placeholder="Tu respuesta"
                          />
                          <button type="submit" disabled={!reply.trim()}>
                            Enviar
                          </button>
                        </div>
                      </form>
                    </>
                  )}
                  {!chatPending && caso.salidas.guardian && (
                    <p className="chat-complete" role="status">
                      Verificación completada. Tu transferencia sigue protegida.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function DecisionCard({ caso }: { caso: Caso | null }) {
  if (!caso?.decision) {
    return (
      <section className="decision-card decision-empty" aria-labelledby="decision-title">
        <p className="eyebrow">Decisión actual</p>
        <h3 id="decision-title">Sin caso activo</h3>
        <p>La acción y su regla aparecerán juntas.</p>
      </section>
    );
  }
  const { accion, regla } = caso.decision;
  return (
    <section
      className={`decision-card decision-${accion.toLowerCase()}`}
      aria-labelledby="decision-title"
    >
      <div>
        <p className="eyebrow">Decisión actual</p>
        <h3 id="decision-title">
          <span className="decision-symbol" aria-hidden="true">
            {accion === "PERMITIR" ? "✓" : accion === "ESCALAR" ? "!" : "Ⅱ"}
          </span>
          {accion}
        </h3>
      </div>
      <div className="rule-block">
        <span>Regla aplicada</span>
        <strong>{regla}</strong>
      </div>
    </section>
  );
}

function Timeline({ caso }: { caso: Caso | null }) {
  return (
    <section className="console-card timeline-card" aria-labelledby="timeline-title">
      <div className="card-title-row">
        <div>
          <p className="eyebrow">En vivo</p>
          <h3 id="timeline-title">Línea de tiempo</h3>
        </div>
        {caso && <span className="case-id">{caso.id}</span>}
      </div>
      <div
        className="timeline"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {!caso ? (
          <p className="empty-copy">Inicia un acto para ver cada control en orden.</p>
        ) : caso.timeline.length === 0 ? (
          <p className="empty-copy">El caso todavía no registra eventos.</p>
        ) : (
          <ol>
            {caso.timeline.map((event, index) => (
              <li key={`${event.t}-${event.evento}-${index}`}>
                <span className="timeline-node" aria-hidden="true" />
                <div>
                  <p>
                    <strong>{eventNames[event.evento] ?? event.evento}</strong>
                    <time dateTime={event.t}>
                      {new Date(event.t).toLocaleTimeString("es-PE", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </time>
                  </p>
                  <span>{actorNames[event.actor] ?? event.actor}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function EvidenceDetail({ evidence }: { evidence: Evidencia | undefined }) {
  if (!evidence) return <p className="evidence-missing">Evidencia no disponible.</p>;
  const data = detailRecord(evidence.dato);
  const account = typeof data?.cuenta === "string" ? data.cuenta : null;
  return (
    <div className="evidence-detail">
      <p>
        <span>Fuente</span>
        <strong>{evidence.fuente.replaceAll("_", " ")}</strong>
      </p>
      {account && (
        <p>
          <span>Cuenta observada</span>
          <strong>{account}</strong>
        </p>
      )}
      <pre>{JSON.stringify(evidence.dato, null, 2)}</pre>
    </div>
  );
}

function Dossier({
  caso,
  busy,
  verdict,
  onVerdict,
}: {
  caso: Caso | null;
  busy: string | null;
  verdict: string | null;
  onVerdict: (value: "mula_confirmada" | "descartada") => Promise<void>;
}) {
  const dossier = caso?.salidas.auditor;
  return (
    <section className="console-card dossier-card" aria-labelledby="dossier-title">
      <div className="card-title-row">
        <div>
          <p className="eyebrow">Auditor</p>
          <h3 id="dossier-title">Expediente citado</h3>
        </div>
        {dossier && (
          <span className="confidence">
            Confianza {dossier.confianza}
          </span>
        )}
      </div>
      {!caso ? (
        <p className="empty-copy">El expediente aparecerá al abrir un caso.</p>
      ) : !dossier ? (
        <div className="loading-copy" role="status">
          <Spinner /> El Auditor aún no emitió un expediente.
        </div>
      ) : (
        <>
          <p className="dossier-summary">{dossier.resumen}</p>
          <div className="findings">
            {dossier.afirmaciones.map((finding, index) => (
              <article key={`${finding.texto}-${index}`}>
                <p>{finding.texto}</p>
                <div className="citations">
                  {finding.evidencia.map((citation) => (
                    <details key={citation}>
                      <summary aria-label={`Abrir evidencia ${citation}`}>
                        {citation}
                      </summary>
                      <EvidenceDetail
                        evidence={caso.evidencia.find(
                          (evidence) => evidence.id === citation,
                        )}
                      />
                    </details>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <div className="verdict-actions">
            <p>Validación humana requerida</p>
            <div>
              <button
                className="button-confirm"
                type="button"
                onClick={() => onVerdict("mula_confirmada")}
                disabled={Boolean(busy)}
              >
                {busy === "verdict-confirm" && <Spinner />}
                Confirmar mula
              </button>
              <button
                className="button-discard"
                type="button"
                onClick={() => onVerdict("descartada")}
                disabled={Boolean(busy)}
              >
                {busy === "verdict-discard" && <Spinner />}
                Descartar
              </button>
            </div>
            {verdict && <p className="verdict-result" role="status">{verdict}</p>}
          </div>
        </>
      )}
    </section>
  );
}

function Metrics({
  caso,
  stats,
  loading,
}: {
  caso: Caso | null;
  stats: Stats | null;
  loading: boolean;
}) {
  const jorgeProtected =
    caso?.transaccion.origen === "C-JORGE" &&
    caso.transaccion.destino === "M-01" &&
    caso.decision?.regla === "P1" &&
    caso.ia.llamadas === 0;

  return (
    <section className="console-card metrics-card" aria-labelledby="metrics-title">
      <div className="card-title-row">
        <div>
          <p className="eyebrow">Eficiencia</p>
          <h3 id="metrics-title">Embudo de decisiones</h3>
        </div>
        <span className="ai-counter">
          <strong>{caso?.ia.llamadas ?? 0}</strong>
          IA en este caso
        </span>
      </div>
      {loading && !stats ? (
        <div className="loading-copy" role="status">
          <Spinner /> Cargando métricas reales…
        </div>
      ) : !stats ? (
        <p className="empty-copy">No hay métricas disponibles.</p>
      ) : (
        <>
          <div className="funnel" aria-label="Embudo del demo">
            <div>
              <strong>{stats.transacciones_evaluadas}</strong>
              <span>Evaluadas</span>
            </div>
            <div>
              <strong>{stats.sospechosas}</strong>
              <span>Sospechosas</span>
            </div>
            <div>
              <strong>{stats.con_llamadas_de_ia}</strong>
              <span>Con IA</span>
            </div>
          </div>
          <div
            className={`jorge-highlight ${jorgeProtected ? "is-protected" : ""}`}
            role="status"
          >
            <ShieldMark />
            <div>
              <p>{jorgeProtected ? "Jorge está protegido" : "Próximo: proteger a Jorge"}</p>
              <strong>
                {jorgeProtected
                  ? "0 llamadas de IA · Regla P1"
                  : stats.metricas.eficiencia_ia.resueltos_por_memoria > 0
                    ? "Memoria activa · 0 llamadas en P1"
                    : "Confirma M-01 y ejecuta el Acto 3"}
              </strong>
            </div>
          </div>
          <p className="estimate-note">
            Llamadas evitadas por memoria:{" "}
            <strong>
              {stats.metricas.eficiencia_ia.llamadas_evitadas_por_memoria
                .estimado ?? "—"}
            </strong>{" "}
            (estimado)
          </p>
        </>
      )}
    </section>
  );
}

function AnalystConsole({
  caso,
  stats,
  statsLoading,
  busy,
  verdict,
  onVerdict,
}: {
  caso: Caso | null;
  stats: Stats | null;
  statsLoading: boolean;
  busy: string | null;
  verdict: string | null;
  onVerdict: (value: "mula_confirmada" | "descartada") => Promise<void>;
}) {
  return (
    <section className="analyst-column" aria-labelledby="analyst-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Operaciones de riesgo</p>
          <h2 id="analyst-title">Consola del analista</h2>
        </div>
        <span className="panel-status">
          <span className="status-dot" />
          Actualización en vivo
        </span>
      </div>
      <DecisionCard caso={caso} />
      <div className="console-grid">
        <Timeline caso={caso} />
        <Metrics caso={caso} stats={stats} loading={statsLoading} />
        <Dossier
          caso={caso}
          busy={busy}
          verdict={verdict}
          onVerdict={onVerdict}
        />
      </div>
    </section>
  );
}

export default function DemoDashboard() {
  const [scenario, setScenario] = useState<ScenarioId>("rosa");
  const [caso, setCaso] = useState<Caso | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  const selectedScenario = useMemo(
    () => scenarios.find((item) => item.id === scenario) ?? scenarios[0],
    [scenario],
  );

  const refreshStats = useCallback(async () => {
    const next = await api<Stats>("/api/stats");
    setStats(next);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([api<Health>("/api/health"), api<Stats>("/api/stats")])
      .then(([nextHealth, nextStats]) => {
        if (!active) return;
        setHealth(nextHealth);
        setStats(nextStats);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "No se pudo iniciar.");
      })
      .finally(() => {
        if (active) setInitialLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!caso?.id) return;
    let active = true;
    const interval = window.setInterval(async () => {
      try {
        const [nextCase, nextStats] = await Promise.all([
          api<Caso>(`/api/cases/${caso.id}`),
          api<Stats>("/api/stats"),
        ]);
        if (active) {
          setCaso(nextCase);
          setStats(nextStats);
        }
      } catch (reason) {
        if (active) {
          setError(
            reason instanceof Error
              ? `Se perdió la actualización en vivo: ${reason.message}`
              : "Se perdió la actualización en vivo.",
          );
        }
      }
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [caso?.id]);

  async function runScenario() {
    setBusy("scenario");
    setError(null);
    setVerdict(null);
    try {
      let next: Caso;
      if (scenario === "alerta") {
        next = await api<Caso>("/api/alerts", {
          method: "POST",
          body: JSON.stringify({
            cuenta: "M-01",
            motivo: "patrón de fan-in con reenvío inmediato",
          }),
        });
      } else {
        const payloads = {
          rosa: {
            transaccion: {
              origen: "C-ROSA",
              destino: "M-01",
              monto: 4800,
              moneda: "PEN",
            },
            contexto: { llamada_activa_o_acceso_remoto: true },
          },
          jorge: {
            transaccion: {
              origen: "C-JORGE",
              destino: "M-01",
              monto: 2200,
              moneda: "PEN",
            },
          },
          bodega: {
            transaccion: {
              origen: "C-JORGE",
              destino: "B-PEPE",
              monto: 2000,
              moneda: "PEN",
            },
          },
          lucia: {
            transaccion: {
              origen: "C-LUCIA",
              destino: "M-02",
              monto: 3000,
              moneda: "PEN",
            },
            contexto: { dispositivo_nuevo_24h: true },
          },
        } as const;
        next = await api<Caso>("/api/transfers", {
          method: "POST",
          body: JSON.stringify(payloads[scenario]),
        });
      }
      setCaso(next);
      await refreshStats();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "No se pudo ejecutar el acto.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function replyGuardian(text: string) {
    if (!caso) return;
    setBusy("reply");
    setError(null);
    try {
      const next = await api<Caso>(
        `/api/cases/${caso.id}/guardian/reply`,
        { method: "POST", body: JSON.stringify({ texto: text }) },
      );
      setCaso(next);
      await refreshStats();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo enviar la respuesta.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function submitVerdict(value: "mula_confirmada" | "descartada") {
    if (!caso) return;
    setBusy(value === "mula_confirmada" ? "verdict-confirm" : "verdict-discard");
    setError(null);
    try {
      await api(`/api/cases/${caso.id}/verdict`, {
        method: "POST",
        body: JSON.stringify({
          veredicto: value,
          validado_por: "analista_demo",
        }),
      });
      const next = await api<Caso>(`/api/cases/${caso.id}`);
      setCaso(next);
      setVerdict(
        value === "mula_confirmada"
          ? "M-01 confirmada por analista_demo. La memoria ya puede proteger a Jorge."
          : "La cuenta fue descartada por analista_demo.",
      );
      await refreshStats();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo registrar el veredicto.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function resetDemo() {
    setBusy("reset");
    setError(null);
    try {
      await api("/api/demo/reset", { method: "POST" });
      setCaso(null);
      setVerdict(null);
      setScenario("rosa");
      await refreshStats();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "No se pudo reiniciar el demo.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="#main-demo" aria-label="Adaptive Financial Security, inicio">
          <span className="brand-mark" aria-hidden="true">
            AF
          </span>
          <span>
            <strong>Adaptive Financial Security</strong>
            <small>Seguridad que aprende, decisiones que se explican</small>
          </span>
        </a>
        <Link className="header-link" href="/experiencia">
          Experiencia del titular
        </Link>
        <div className="synthetic-notice" role="note">
          <span aria-hidden="true">SYN</span>
          <p>
            <strong>Datos 100% sintéticos</strong>
            <small>{health?.agentes === "claude" ? "Agentes Claude" : "Agentes en modo simulado"}</small>
          </p>
        </div>
      </header>

      <section className="demo-controls" aria-labelledby="demo-controls-title">
        <div>
          <p className="eyebrow">Demo guiado</p>
          <h1 id="demo-controls-title">Una pantalla. Dos frentes de protección.</h1>
          <p>
            Sigue el dinero desde la pausa preventiva hasta la decisión humana
            que protege a la siguiente persona.
          </p>
        </div>
        <div className="control-actions">
          <label htmlFor="scenario">Acto o escenario</label>
          <div>
            <select
              id="scenario"
              value={scenario}
              onChange={(event) => setScenario(event.target.value as ScenarioId)}
              disabled={Boolean(busy)}
            >
              {scenarios.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.act} · {item.title}
                </option>
              ))}
            </select>
            <button
              className="button-primary"
              type="button"
              onClick={runScenario}
              disabled={Boolean(busy)}
            >
              {busy === "scenario" ? <Spinner /> : null}
              Ejecutar
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={resetDemo}
              disabled={Boolean(busy)}
            >
              {busy === "reset" ? <Spinner /> : null}
              Reiniciar demo
            </button>
          </div>
          <p className="scenario-description">
            <strong>{selectedScenario.act}:</strong>{" "}
            {selectedScenario.description}
          </p>
        </div>
      </section>

      {initialLoading && (
        <div className="global-message" role="status">
          <Spinner /> Conectando con el sistema…
        </div>
      )}
      {error && (
        <div className="global-message global-error" role="alert">
          <strong>No pudimos completar la acción.</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            Cerrar
          </button>
        </div>
      )}

      <div className="two-panel-layout" id="main-demo">
        <ClientPanel
          caso={caso}
          scenario={scenario}
          busy={busy}
          onReply={replyGuardian}
        />
        <AnalystConsole
          caso={caso}
          stats={stats}
          statsLoading={initialLoading}
          busy={busy}
          verdict={verdict}
          onVerdict={submitVerdict}
        />
      </div>

      <footer className="site-footer">
        <p>{health?.datos.nota ?? "DATOS 100% SINTÉTICOS"}</p>
        <p>Demo sin autenticación · Estado temporal en memoria</p>
      </footer>
    </main>
  );
}
