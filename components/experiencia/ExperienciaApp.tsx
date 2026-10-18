"use client";

import Link from "next/link";
import { FormEvent, useEffect, useReducer, useRef, useState, type RefObject } from "react";
import {
  beneficiariosDe,
  CODIGO_VISIBLE,
  crearEstado,
  decisionDelMomento,
  dispositivosDe,
  entradaPrueba,
  escalones,
  historialDe,
  NOTA_SINTETICA,
  PROMEDIO_90D,
  reducir,
  SALIDAS_ORDEN,
  saldosDe,
  soles,
  textoPaso,
  TITULAR,
} from "@/lib/experiencia";
import { decidir } from "@/lib/experiencia/motor";
import type { Accion, Estado, Vista } from "@/lib/experiencia/estado";
import type { EventoRiesgo, ModoUsuario, Salida } from "@/lib/experiencia/tipos";

const MODOS: Array<{ id: ModoUsuario; etiqueta: string }> = [
  { id: "disponible", etiqueta: "Disponible" },
  { id: "inalcanzable", etiqueta: "Inalcanzable" },
  { id: "dispositivo_comprometido", etiqueta: "Dispositivo comprometido" },
  { id: "canal_alternativo", etiqueta: "Canal alternativo" },
];

const EVENTOS: Array<{ id: EventoRiesgo; etiqueta: string }> = [
  { id: "beneficiario_nuevo", etiqueta: "Beneficiario nuevo" },
  { id: "monto_anomalo", etiqueta: "Monto anómalo" },
  { id: "dispositivo_nuevo", etiqueta: "Dispositivo nuevo" },
  { id: "acceso_remoto", etiqueta: "Acceso remoto" },
  { id: "usuario_inalcanzable", etiqueta: "Usuario inalcanzable" },
];

const MONTOS = [200, 900, 2200, 4800, 8400];

const CANAL: Record<string, string> = {
  ninguno: "Sin reto pendiente",
  app: "App",
  app_escrita: "Pasos escritos en la app",
  segundo_dispositivo: "Tablet de casa",
  presencial: "Agencia",
};

function etiquetaModo(modo: ModoUsuario): string {
  return MODOS.find((item) => item.id === modo)?.etiqueta ?? modo;
}

function situacionDelRecorrido(estado: Estado): string {
  if (estado.paso === "regreso" || estado.paso === "cierre") return "De vuelta";
  if (estado.paso === "viaje" || estado.paso === "contraste") return "Inalcanzable";
  return etiquetaModo(estado.modo);
}

export default function ExperienciaApp() {
  const [estado, dispatch] = useReducer(reducir, "viajero", crearEstado);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const primerRender = useRef(true);
  const decision = decisionDelMomento(estado);
  const prueba = decidir(entradaPrueba(estado));
  const saldos = saldosDe(estado);
  const [bitacora, setBitacora] = useState<string[]>([]);
  const firmaPrueba = [
    prueba.regla,
    prueba.score,
    prueba.salida,
    estado.pruebaModo,
    estado.pruebaEventos.join(","),
    estado.pruebaMonto,
    estado.pruebaHabitual,
    estado.politicaViaje,
    estado.vozDisponible,
    estado.permitirHabituales,
  ].join("|");

  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    tituloRef.current?.focus();
  }, [estado.paso, estado.escenario, estado.vista]);

  useEffect(() => {
    const linea = `${prueba.regla} · score ${prueba.score} · ${nombreSalida(prueba.salida)}`;
    setBitacora((prev) => (prev[0] === linea ? prev : [linea, ...prev].slice(0, 5)));
  }, [firmaPrueba, prueba.regla, prueba.score, prueba.salida]);

  return (
    <div className="sfa">
      <a className="sfa-skip" href="#momento">
        Saltar al recorrido
      </a>
      <div className="sfa-wrap">
        <header className="sfa-header">
          <div className="sfa-marca">
            <span className="sfa-emblema" aria-hidden="true">
              <Escudo />
            </span>
            <div>
              <p className="sfa-kicker">Banca demo · Perú</p>
              <h1>Seguridad Financiera Adaptativa</h1>
              <p>La cuenta sigue protegida cuando no puedes responder.</p>
            </div>
          </div>
          <div className="sfa-header-side">
            <p className="sfa-sintetico">{NOTA_SINTETICA}</p>
            <Link href="/">Consola de agentes</Link>
            <button type="button" className="sfa-btn sfa-btn-calma" onClick={() => dispatch({ type: "reiniciar" })}>
              Reiniciar recorrido
            </button>
          </div>
        </header>
        <p className="sfa-evidencia">
          Usuario de esta demo: Lucía Flores, titular de una cuenta en soles. En Perú, 47% de quienes
          usan finanzas digitales estuvo expuesto a fraude en 2025 y, de ese grupo, 11% dejó el servicio.
          En Latinoamérica, los intentos de estafa por ingeniería social crecieron 155% en 2025. La
          protección de hoy pide una respuesta que a veces no puede llegar.
        </p>

        <nav className="sfa-escenarios" aria-label="Recorridos de la demo">
          <Escenario
            activo={estado.vista === "recorrido" && estado.escenario === "viajero"}
            kicker="Recorrido 1"
            titulo="Viajero sin señal"
            onClick={() => dispatch({ type: "escenario", id: "viajero" })}
          />
          <Escenario
            activo={estado.vista === "recorrido" && estado.escenario === "manipulado"}
            kicker="Recorrido 2"
            titulo="Autenticada, pero guiada"
            onClick={() => dispatch({ type: "escenario", id: "manipulado" })}
          />
          <Escenario
            activo={estado.vista === "recorrido" && estado.escenario === "canal"}
            kicker="Recorrido 3"
            titulo="Canal que sí puedes usar"
            onClick={() => dispatch({ type: "escenario", id: "canal" })}
          />
          <Escenario
            activo={estado.vista === "probar"}
            kicker="Panel"
            titulo="Probar reglas"
            onClick={() => dispatch({ type: "vista", vista: "probar" })}
          />
        </nav>

        <div className="sfa-grid">
          <Cuenta estado={estado} dispatch={dispatch} saldos={saldos} />
          <main className="sfa-momento" id="momento">
            {estado.vista === "probar" ? (
              <Prueba
                tituloRef={tituloRef}
                decision={prueba}
                estado={estado}
                onVolver={() => dispatch({ type: "vista", vista: "recorrido" })}
              />
            ) : (
              <Recorrido tituloRef={tituloRef} estado={estado} dispatch={dispatch} />
            )}
          </main>
          <DecisionPanel estado={estado} decision={decision} />
        </div>

        <PanelControl estado={estado} dispatch={dispatch} prueba={prueba} bitacora={bitacora} />
        <details className="sfa-fuera">
          <summary>Qué decide esta demo y qué quedó fuera</summary>
          <p>
            Entra: cuenta simulada, políticas en lenguaje llano, cuatro modos, cinco eventos, tres
            recorridos y un motor de reglas determinista. La IA no mueve dinero. Queda fuera: core
            bancario, modelo de machine learning, KYC, red interbancaria y un catálogo largo de fraudes.
            El conteo de abajo es de esta visita, no una métrica de usuarios.
          </p>
        </details>
      </div>
    </div>
  );
}

function Escenario({
  activo,
  kicker,
  titulo,
  onClick,
}: {
  activo: boolean;
  kicker: string;
  titulo: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="sfa-escenario" aria-pressed={activo} onClick={onClick}>
      <span>{kicker}</span>
      <strong>{titulo}</strong>
    </button>
  );
}

function Cuenta({
  estado,
  dispatch,
  saldos,
}: {
  estado: Estado;
  dispatch: (accion: Accion) => void;
  saldos: { saldo: number; enPausa: number; disponible: number };
}) {
  return (
    <aside className="sfa-cuenta" aria-labelledby="cuenta-titulo">
      <p className="sfa-kicker">Cuenta de ahorros · {TITULAR}</p>
      <h2 id="cuenta-titulo" className="sfa-saldo">
        <span className="sfa-sr">Saldo de {TITULAR}: </span>
        {soles(saldos.saldo)}
      </h2>
      <p className="sfa-cuenta-meta">
        Disponible {soles(saldos.disponible)}
        {saldos.enPausa > 0 ? ` · En pausa ${soles(saldos.enPausa)}` : ""}
      </p>
      <p className="sfa-cuenta-meta">Situación del recorrido: {situacionDelRecorrido(estado)}</p>

      <section aria-labelledby="politicas-titulo">
        <h3 id="politicas-titulo">Protección que ella eligió</h3>
        <div className="sfa-toggles">
          <Toggle
            pressed={estado.politicaViaje}
            onClick={() => dispatch({ type: "politica", valor: !estado.politicaViaje })}
            titulo="En viaje, un beneficiario nuevo sobre S/ 500 se retiene."
            detalle="Para cuando no pueda responder."
          />
          <Toggle
            pressed={estado.permitirHabituales}
            onClick={() => dispatch({ type: "habituales", valor: !estado.permitirHabituales })}
            titulo="El pago al Hotel Sol Andino sigue disponible durante una retención."
            detalle="Salida de emergencia."
          />
          <Toggle
            pressed={!estado.vozDisponible}
            onClick={() => dispatch({ type: "voz", valor: !estado.vozDisponible })}
            titulo="La voz no me sirve."
            detalle="Preferencia de canal. No cambia el puntaje."
          />
        </div>
      </section>

      <Lista titulo="Beneficiarios" filas={beneficiariosDe(estado)} />
      <Lista titulo="Dispositivos" filas={dispositivosDe(estado)} />
      <Lista titulo="Movimientos" filas={historialDe(estado)} conMonto />
      <p className="sfa-cuenta-meta">Promedio de sus transferencias: {soles(PROMEDIO_90D)}.</p>
    </aside>
  );
}

function Toggle({
  pressed,
  onClick,
  titulo,
  detalle,
}: {
  pressed: boolean;
  onClick: () => void;
  titulo: string;
  detalle: string;
}) {
  return (
    <button type="button" className="sfa-toggle" aria-pressed={pressed} onClick={onClick}>
      <span className="sfa-switch" aria-hidden="true" />
      <span>
        <strong>{titulo}</strong>
        <small>{detalle}</small>
      </span>
    </button>
  );
}

function Lista({
  titulo,
  filas,
  conMonto = false,
}: {
  titulo: string;
  filas: Array<{ id: string; titulo: string; detalle: string; monto?: number; tono?: string }>;
  conMonto?: boolean;
}) {
  return (
    <section aria-labelledby={`lista-${titulo}`}>
      <h3 id={`lista-${titulo}`}>{titulo}</h3>
      <ul className="sfa-lista">
        {filas.map((fila) => (
          <li key={fila.id} data-tono={fila.tono ?? "neutro"}>
            <span>
              <strong>{fila.titulo}</strong>
              <small>{fila.detalle}</small>
            </span>
            {conMonto && fila.monto !== undefined && <b>{soles(fila.monto)}</b>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Recorrido({
  tituloRef,
  estado,
  dispatch,
}: {
  tituloRef: RefObject<HTMLHeadingElement | null>;
  estado: Estado;
  dispatch: (accion: Accion) => void;
}) {
  const texto = textoPaso(estado);
  const pasos = escalones(estado);
  return (
    <>
      <ol className="sfa-stepper" aria-label="Momentos del recorrido">
        {pasos.map((paso) => (
          <li key={paso.nombre} aria-current={paso.actual ? "step" : undefined} data-hecho={paso.hecho}>
            {paso.nombre}
          </li>
        ))}
      </ol>
      <p className="sfa-kicker">{texto.kicker}</p>
      <h2 id="momento-titulo" ref={tituloRef} tabIndex={-1}>
        {texto.titulo}
      </h2>
      {texto.parrafos.map((parrafo) => (
        <p key={parrafo}>{parrafo}</p>
      ))}
      {estado.paso === "contraste" && <Contraste />}
      {estado.paso === "regreso" && estado.retencion && (
        <p className="sfa-monto-pausa">
          <span>En pausa, en tu cuenta</span>
          <strong>{soles(estado.retencion.monto)}</strong>
        </p>
      )}
      {estado.paso === "preferencia" && (
        <blockquote className="sfa-cita">
          <p>La voz no me sirve.</p>
          <footer>Preferencia de Lucía. No es un dato de salud.</footer>
        </blockquote>
      )}
      {estado.paso === "interrupcion" && <Autenticacion />}
      {estado.paso === "escrito" && <RetoEscrito estado={estado} dispatch={dispatch} />}
      {texto.acciones.length > 0 && (
        <div className="sfa-acciones">
          {texto.acciones.map((accion) => (
            <button
              key={accion.id}
              type="button"
              className={`sfa-btn sfa-btn-${accion.variante}`}
              onClick={() => dispatch({ type: "avanzar", id: accion.id })}
            >
              {accion.etiqueta}
              {accion.ayuda && <small>{accion.ayuda}</small>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Contraste() {
  return (
    <figure className="sfa-figura" aria-labelledby="figura-titulo">
      <figcaption id="figura-titulo">Sin respuesta, el resultado cambia en el tercer paso.</figcaption>
      <div className="sfa-figura-fila">
        <p>Hoy: alertar y esperar</p>
        <ol>
          <li>
            <strong>Operación riesgosa</strong>
            <span>dispositivo nuevo</span>
          </li>
          <li>
            <strong>Alerta enviada</strong>
            <span>nadie la ve</span>
          </li>
          <li className="sfa-sale">
            <strong>El dinero sale</strong>
            <span>silencio = aprobado</span>
          </li>
          <li>
            <strong>Reclamo tardío</strong>
            <span>vuelve el día 4</span>
          </li>
        </ol>
      </div>
      <div className="sfa-figura-fila">
        <p>Con la capa: retener hasta que vuelva</p>
        <ol>
          <li>
            <strong>Operación riesgosa</strong>
            <span>dispositivo nuevo</span>
          </li>
          <li>
            <strong>Alerta enviada</strong>
            <span>nadie la ve</span>
          </li>
          <li className="sfa-hold">
            <strong>Retención</strong>
            <span>el dinero no sale</span>
          </li>
          <li>
            <strong>Verifica al volver</strong>
            <span>libera o cancela</span>
          </li>
        </ol>
      </div>
      <p className="sfa-figura-nota">Aquí cambia el resultado.</p>
    </figure>
  );
}

function Autenticacion() {
  return (
    <ul className="sfa-checks" aria-label="Controles que sí pasaron">
      <li>Celular conocido. Correcto.</li>
      <li>Biometría. Correcta.</li>
      <li>Código de un solo uso. Correcto.</li>
    </ul>
  );
}

function RetoEscrito({
  estado,
  dispatch,
}: {
  estado: Estado;
  dispatch: (accion: Accion) => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [ocultarError, setOcultarError] = useState(false);
  const error = estado.codigoError && !ocultarError;

  function enviar(event: FormEvent) {
    event.preventDefault();
    setOcultarError(false);
    dispatch({ type: "avanzar", id: "confirmar", codigo: codigo.trim() });
  }

  return (
    <form className="sfa-reto" onSubmit={enviar}>
      <p className="sfa-rechazo">
        <span>Llamada de voz</span> No está entre tus preferencias.
      </p>
      <p>
        Código en pantalla: <strong className="sfa-codigo">{CODIGO_VISIBLE}</strong>
      </p>
      <label htmlFor="codigo-reto">Escribe el código que ves</label>
      <div className="sfa-reto-fila">
        <input
          id="codigo-reto"
          inputMode="numeric"
          autoComplete="off"
          value={codigo}
          aria-invalid={error}
          aria-describedby={error ? "codigo-error" : undefined}
          onChange={(event) => {
            setCodigo(event.target.value);
            setOcultarError(true);
          }}
        />
        <button className="sfa-btn sfa-btn-primaria" type="submit">
          Confirmar sola
        </button>
      </div>
      {error && (
        <p id="codigo-error" role="alert">
          Ese código no coincide con el {CODIGO_VISIBLE} de arriba. Puedes intentarlo de nuevo, sin ayuda de otra persona.
        </p>
      )}
    </form>
  );
}

function Prueba({
  tituloRef,
  decision,
  estado,
  onVolver,
}: {
  tituloRef: RefObject<HTMLHeadingElement | null>;
  decision: ReturnType<typeof decidir>;
  estado: Estado;
  onVolver: () => void;
}) {
  const destino = estado.pruebaHabitual ? "Hotel Sol Andino" : "Cuenta nueva";
  return (
    <>
      <p className="sfa-kicker">Prueba suelta · no altera el recorrido</p>
      <h2 id="momento-titulo" ref={tituloRef} tabIndex={-1}>
        {decision.titulo}
      </h2>
      <p>
        {soles(estado.pruebaMonto)} hacia {destino}. Modo {etiquetaModo(estado.pruebaModo).toLowerCase()}.
        {estado.pruebaEventos.length === 0
          ? " Sin señales de operación."
          : ` Señales: ${estado.pruebaEventos.map((id) => EVENTOS.find((item) => item.id === id)?.etiqueta).join(", ")}.`}
      </p>
      <p>{decision.motivo}</p>
      <ul className="sfa-porque">
        {decision.porqueTitular.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="sfa-acciones">
        <button type="button" className="sfa-btn sfa-btn-secundaria" onClick={onVolver}>
          Volver al recorrido
        </button>
      </div>
    </>
  );
}

function DecisionPanel({
  estado,
  decision,
}: {
  estado: Estado;
  decision: ReturnType<typeof decisionDelMomento>;
}) {
  const [vista, setVista] = useState<"titular" | "analista">("titular");
  return (
    <aside className="sfa-rail" aria-labelledby="decision-titulo">
      <p className="sfa-kicker">Decisión explicada</p>
      <div aria-live="polite" aria-atomic="true">
        <h2 id="decision-titulo">{decision ? decision.titulo : "Todavía no hay una operación"}</h2>
        <p>{decision ? decision.motivo : "Cuando llegue, verás la salida y la regla. La IA no mueve dinero."}</p>
      </div>
      {estado.resolucion === "cancelada" && (
        <p className="sfa-nota-ok">La cancelaste al volver. Esa plata no llegó a salir.</p>
      )}
      {estado.resolucion === "liberada" && estado.vista === "recorrido" && (
        <p className="sfa-nota-ok">La liberaste después de confirmar por la tablet. Antes de eso, no había salido.</p>
      )}
      <FichaMotor estado={estado} decision={decision} />
      <ol className="sfa-salidas" aria-label="Cinco salidas posibles">
        {SALIDAS_ORDEN.map((salida) => (
          <li key={salida.id} data-activa={decision?.salida === salida.id} data-salida={salida.id}>
            <span>{salida.nivel}</span>
            <strong>{salida.titulo}</strong>
            <small>{salida.resumen}</small>
          </li>
        ))}
      </ol>
      {decision && (
        <>
          <p className="sfa-regla">
            Regla {decision.regla} · equivale a {decision.equivalentePolicy}
            {decision.politicaCitada ? ` · cita: «${decision.politicaCitada}»` : ""}
          </p>
          <ul className="sfa-porque">
            {decision.porqueTitular.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {decision.canal !== "ninguno" && (
            <p className="sfa-cuenta-meta">
              Canal: {CANAL[decision.canal]}.
              {decision.canalEvitado ? ` No usamos ${decision.canalEvitado}.` : ""}
            </p>
          )}
          <details className="sfa-analista-detalle">
            <summary>Detalle para el analista</summary>
            <ul>
              {decision.porqueAnalista.map((item) => (
                <li key={item}>{item}</li>
              ))}
              <li>Score {decision.score}. Nivel {decision.nivel}.</li>
              <li>IA decide fondos: no. Silencio es aprobación: no.</li>
            </ul>
          </details>
        </>
      )}

      <div className="sfa-tiempo">
        <div className="sfa-tabs" role="tablist" aria-label="Versión de la línea de tiempo">
          <button
            type="button"
            role="tab"
            id="tab-titular"
            aria-selected={vista === "titular"}
            aria-controls="panel-tiempo"
            onClick={() => setVista("titular")}
          >
            Titular
          </button>
          <button
            type="button"
            role="tab"
            id="tab-analista"
            aria-selected={vista === "analista"}
            aria-controls="panel-tiempo"
            onClick={() => setVista("analista")}
          >
            Analista
          </button>
        </div>
        <div
          role="tabpanel"
          id="panel-tiempo"
          aria-labelledby={vista === "titular" ? "tab-titular" : "tab-analista"}
        >
          {estado.hechos.length === 0 ? (
            <p>Los hechos de este recorrido aparecen aquí, en orden.</p>
          ) : (
            <ol className="sfa-hechos">
              {estado.hechos.map((hecho) => (
                <li key={hecho.id}>
                  <p>
                    <strong>{vista === "titular" ? hecho.titularTitulo : hecho.analistaTitulo}</strong>
                    <time>{hecho.cuando}</time>
                  </p>
                  <span>{vista === "titular" ? hecho.titularDetalle : hecho.analistaDetalle}</span>
                  {vista === "analista" && <small>{hecho.id}</small>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </aside>
  );
}

function FichaMotor({
  estado,
  decision,
}: {
  estado: Estado;
  decision: ReturnType<typeof decisionDelMomento>;
}) {
  const enPrueba = estado.vista === "probar";
  const modo = enPrueba ? estado.pruebaModo : estado.modo;
  const monto = enPrueba ? estado.pruebaMonto : estado.operacion?.monto;
  const eventos = enPrueba ? estado.pruebaEventos : (estado.operacion?.eventos ?? []);
  return (
    <div className="sfa-ficha" aria-label="Ficha del motor de reglas">
      <p className="sfa-kicker">Motor de reglas · determinista</p>
      <dl>
        <div>
          <dt>Entrada</dt>
          <dd>
            Modo {etiquetaModo(modo).toLowerCase()}
            {monto !== undefined ? ` · ${soles(monto)}` : " · sin operación"}
            {eventos.length === 0 ? " · sin señales" : ""}
          </dd>
        </div>
        <div>
          <dt>Señales</dt>
          <dd>
            {decision && decision.senales.length > 0
              ? decision.senales.map((senal) => `${senal.id} +${senal.puntos}`).join(" · ")
              : "Ninguna señal de operación"}
          </dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd>{decision ? `${decision.score} · nivel ${decision.nivel}` : "—"}</dd>
        </div>
        <div>
          <dt>Regla</dt>
          <dd>{decision ? `${decision.regla} → ${decision.equivalentePolicy}` : "Aún no corre"}</dd>
        </div>
        <div>
          <dt>Acción</dt>
          <dd>{decision ? decision.titulo : "Esperando"}</dd>
        </div>
        <div>
          <dt>Fondos</dt>
          <dd>{decision ? (decision.fondosSalen ? "Salen" : "No salen") : "No se mueven"}</dd>
        </div>
      </dl>
    </div>
  );
}

function PanelControl({
  estado,
  dispatch,
  prueba,
  bitacora,
}: {
  estado: Estado;
  dispatch: (accion: Accion) => void;
  prueba: ReturnType<typeof decidir>;
  bitacora: string[];
}) {
  function toggle(id: EventoRiesgo) {
    const eventos = estado.pruebaEventos.includes(id)
      ? estado.pruebaEventos.filter((item) => item !== id)
      : [...estado.pruebaEventos, id];
    dispatch({ type: "prueba_eventos", eventos });
  }

  return (
    <section className="sfa-panel" aria-labelledby="panel-titulo">
      <div className="sfa-panel-head">
        <h2 id="panel-titulo">Controles de la demo</h2>
        <p>El modo es la situación. Los eventos son de la operación. Estar inalcanzable no suma puntaje.</p>
      </div>
      <fieldset>
        <legend>Modo de la persona</legend>
        <div className="sfa-chips">
          {MODOS.map((modo) => (
            <button
              key={modo.id}
              type="button"
              aria-pressed={estado.pruebaModo === modo.id}
              onClick={() => dispatch({ type: "prueba_modo", modo: modo.id })}
            >
              {modo.etiqueta}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Eventos de riesgo</legend>
        <div className="sfa-chips">
          {EVENTOS.map((evento) => (
            <button
              key={evento.id}
              type="button"
              aria-pressed={estado.pruebaEventos.includes(evento.id)}
              onClick={() => toggle(evento.id)}
            >
              {evento.etiqueta}
            </button>
          ))}
          <button type="button" aria-pressed={estado.pruebaHabitual} onClick={() => dispatch({ type: "prueba_hotel" })}>
            Pago habitual al hotel
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Monto</legend>
        <div className="sfa-chips">
          {MONTOS.map((monto) => (
            <button
              key={monto}
              type="button"
              aria-pressed={!estado.pruebaHabitual && estado.pruebaMonto === monto}
              onClick={() => dispatch({ type: "prueba_monto", monto })}
            >
              {soles(monto)}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="sfa-panel-resultado" aria-live={estado.vista === "recorrido" ? "polite" : "off"}>
        <p>
          <strong>
            {prueba.regla} · score {prueba.score} · {nombreSalida(prueba.salida)}
          </strong>
        </p>
        <p>{prueba.motivo}</p>
        <p>{prueba.fondosSalen ? "Con esta entrada, los fondos salen." : "Con esta entrada, los fondos no salen."}</p>
      </div>
      {estado.vista !== "probar" && (
        <button
          type="button"
          className="sfa-btn sfa-btn-secundaria"
          onClick={() => dispatch({ type: "vista", vista: "probar" satisfies Vista })}
        >
          Ver esta prueba
        </button>
      )}
      <div className="sfa-bitacora">
        <p>Últimas evaluaciones del motor en esta visita. Es este navegador, no un conteo de usuarios.</p>
        {bitacora.length > 0 && (
          <ol>
            {bitacora.map((linea, indice) => (
              <li key={`${linea}-${indice}`}>{linea}</li>
            ))}
          </ol>
        )}
      </div>
      <PreferenciaBanco />
    </section>
  );
}

function PreferenciaBanco() {
  const [valor, setValor] = useState<string | null>(null);
  useEffect(() => {
    try {
      setValor(window.localStorage.getItem("sfa-activaria"));
    } catch {
      setValor(null);
    }
  }, []);

  function elegir(siguiente: "si" | "no") {
    try {
      window.localStorage.setItem("sfa-activaria", siguiente);
    } catch {
      // si el almacenamiento está bloqueado, la respuesta queda solo en pantalla
    }
    setValor(siguiente);
  }

  return (
    <fieldset className="sfa-activaria">
      <legend>¿Activarías esta protección en tu banco?</legend>
      <p>Se guarda en este navegador. No es una lista de espera ni un dato de otras personas.</p>
      <div className="sfa-chips">
        <button type="button" aria-pressed={valor === "si"} onClick={() => elegir("si")}>
          Sí, la activaría
        </button>
        <button type="button" aria-pressed={valor === "no"} onClick={() => elegir("no")}>
          Todavía no
        </button>
      </div>
      {valor && <p role="status">Respuesta guardada en este navegador: {valor === "si" ? "sí" : "todavía no"}.</p>}
    </fieldset>
  );
}

function nombreSalida(id: Salida): string {
  return SALIDAS_ORDEN.find((salida) => salida.id === id)?.titulo ?? id;
}

function Escudo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28">
      <path
        d="M16 3 27 7.2v8.2c0 6.4-4.2 10.8-11 13.1C9.2 26.2 5 21.8 5 15.4V7.2L16 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M12 14.5v6M20 14.5v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
