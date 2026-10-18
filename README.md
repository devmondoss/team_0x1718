# Adaptive Financial Security

> **Si alguien intenta estafarte, pausamos el pago, investigamos la cuenta que
> iba a recibir tu dinero y, si es una mula, la próxima víctima ya está
> protegida.**

Capa de protección multiagente que se inserta entre el risk engine de un banco
y la ejecución del pago, y sobre la cola de alertas AML.

Hackathon · Track 04 (seguridad: estafa, extorsión, suplantación) + reto B1
(investigación de alertas AML).

## Demo para el jurado

La pantalla que se presenta en vivo es **`/experiencia`**: la cuenta de Lucía
Flores (datos sintéticos, soles) y los tres recorridos del
[brief UX](docs/ux/brief_ux_conceptual.md). No pide variables de entorno ni
clave de modelo. El motor de reglas corre en el navegador.

```bash
npm install
npm run dev          # http://localhost:3000/experiencia
npm run build        # el build no exige ANTHROPIC_API_KEY
npm start            # producción local, mismo path
```

La consola de agentes (Rosa, la mula, Jorge) sigue en `/`. Sin
`ANTHROPIC_API_KEY` los agentes van en modo simulado, que es el default. El
resto de variables está en [`.env.example`](.env.example): todas opcionales.
No hay secretos en el repo.

### URL pública (Vercel)

Localhost no cuenta para la rúbrica. El proyecto es Next.js y el build de
`/experiencia` no depende de estado en servidor, así que Vercel lo sirve igual
que en local.

1. Importar este repositorio en Vercel (framework Next.js, comando `npm run build`).
2. No hace falta configurar variables para la demo del titular.
3. Abrir `https://<tu-deploy>/experiencia`.

La consola de `/` guarda casos en memoria del proceso. En serverless cada
instancia tiene la suya; para esa consola el camino fiel es `npm run servidor`
en una laptop. La experiencia del titular no tiene ese límite.

### Problema y usuario

Lucía es titular de una cuenta en Perú. Puede estar sin señal, en una llamada
que la guía, o ante un reto de voz que no puede usar. Hoy el banco detecta la
operación y espera una respuesta: si nadie contesta, el silencio se parece a
un sí.

Evidencia citada en el brief: en 2025, 47% de usuarios de finanzas digitales
en Perú estuvo expuesto a fraude y 11% de los afectados dejó el servicio
(SBS + CGAP). En Latinoamérica, los intentos de estafa por ingeniería social
crecieron 155% (BioCatch). Esas cifras están también en la pantalla, como
contexto, no como alarma.

### Qué hace el motor, y qué no

`lib/experiencia/motor.ts` elige una de cinco salidas —permitir, reto
adaptativo, reto fuera del canal, retención protectora, bloquear y revisión—
con la primera regla que aplica (E0–E12). La ficha de la pantalla muestra la
entrada, las señales con su puntaje, el score, la regla y si los fondos salen.
Estar inalcanzable no suma riesgo. «La voz no me sirve» es una preferencia de
canal, no un dato de salud. La IA no mueve dinero: la decisión es la regla.

Los controles de abajo arman una operación suelta. Cambian modo, eventos y
monto sin romper el recorrido. Sirven para una pregunta fuera del guion.

Quedó fuera a propósito: core bancario, KYC, red interbancaria, un modelo de
machine learning y un catálogo largo de fraudes. El conteo de evaluaciones es
de la visita en ese navegador. No es una métrica de usuarios ni una lista de
espera.

---

## ⚠️ Todos los datos son sintéticos

`lib/data/seed.json` lo genera `scripts/seed.ts` con un PRNG determinista
(semilla 1718). **No corresponde a ninguna persona, cuenta ni institución
real.** Ningún registro contiene atributos demográficos, de salud ni
socioeconómicos — ver *Sobre los sesgos* más abajo.

No hay core bancario, ni modelo de ML entrenado, ni KYC, ni red interbancaria.
Las cifras del demo son de una simulación, no de producción.

---

## Correrlo

Node 20+.

```bash
npm install
cp .env.example .env.local      # opcional: solo si vas a conectar el LLM
npm run demo                    # ← empieza por aquí
```

`npm run demo` recorre los 5 casos de uso en consola y muestra, por cada uno,
la decisión, la regla aplicada, la evidencia citada y el consumo de IA. Es la
forma más rápida de ver qué hace el sistema.

```bash
npm run dev        # desarrollo en http://localhost:3000
npm test           # 431 tests
npm run typecheck
npm run seed       # regenera lib/data/seed.json (determinista)
```

La pantalla de dos paneles (📱 cliente · 🖥️ consola del analista) está en `/`
y consume la API documentada en [docs/work/API.md](docs/work/API.md).

### Para presentar: la laptop como servidor

```bash
npm run servidor                                  # localhost:3000, demo limpio
npm run servidor -- --red --juego                 # + celulares por Wi-Fi y movimientos en vivo
npm run servidor -- --red --juego --persistir     # + sobrevive a un reinicio
```

Un solo proceso continuo, **no serverless**: el estado vive en RAM y en
Vercel cada instancia tendría el suyo, con lo que el acto de Jorge fallaría al
azar. El script compila, arranca, reinicia el demo y muestra las URLs. Si se
expone fuera de `localhost` (`--red`, `--tunel`) exige un **token de
operador** para reiniciar y confirmar mulas, y lo genera si falta. Detalle en
[API.md §12](docs/work/API.md).

Antes de presentar: `GET /api/health` → revisar `modos`.

---

## Qué hace, en concreto

```
Transferencia ──► Reglas nivel 0 (sin IA)
                      │ score ≥ 5
                      ▼
                 PAUSA PREVENTIVA  ← el dinero se retiene ANTES de llamar a
                      │              cualquier agente (TTPA ≈ 0)
                      ▼
                 🧠 Memoria ──► mula conocida → P1, 0 llamadas de IA
                      │
                      ▼
                 🧭 Coordinador ──► decide qué especialistas hacen falta
                      │
            ┌─────────┴─────────┐
            ▼                   ▼
      🛡️ Guardián          🔍 Detective
      lado cliente         cuenta destino
            └─────────┬─────────┘
                      ▼
            Policy Engine determinista
            PERMITIR / VERIFICAR / PAUSAR / ESCALAR
                      │
                      ▼
            📋 Auditor ──► expediente con evidencia citada
                      │
                      ▼
            👤 Analista confirma ──► 🧠 Memoria
```

Tres principios que explican el diseño:

**El LLM razona; no decide sobre el dinero.** El Policy Engine es determinista
(P1–P10, la primera regla que aplica gana) y toda decisión guarda su regla, así
es explicable y auditable.

**Las tools calculan; los agentes interpretan.** Los hechos del expediente
(«14 remitentes nuevos en 48h», «91% reenviado en menos de 2h») los calculan
funciones deterministas en `lib/analytics/`. Si el resumen del modelo trae una cifra que no está en la evidencia, se retira y el caso pasa a revisión manual.

**Los ids de evidencia los emite el sistema.** `lib/evidence/ledger.ts` asigna
`E-01`, `E-02`… y cada afirmación del expediente debe citar uno que exista. Una
cita a un id inexistente es una alucinación detectable, no un texto plausible.

---

## Los 5 casos de uso

Salida real de `npm run demo`:

| Caso | Escenario | Resultado | Regla | IA |
|---|---|---|:-:|:-:|
| **CU-01** | Rosa transfiere S/4,800 guiada por una llamada del «banco» | ESCALAR | P4 | 2 |
| **CU-02** | Alerta AML sobre la cuenta destino → expediente para el analista | ESCALAR | P5 | 1 |
| **CU-03** | Jorge transfiere a la misma mula, ya confirmada | ESCALAR | **P1** | **0** |
| **CU-05** | Primer pago grande a Bodega Don Pepe (negocio legítimo) | PERMITIR | P8 | 1 |
| **CU-04** | Atacante desde dispositivo nuevo; Lucía viaja sin señal | PAUSAR | P7 | 1 |
| | …y su pago recurrente al hotel sigue pasando | PERMITIR | P2 | 0 |

**CU-05 es el control de falsos positivos y el caso más instructivo.** La
bodega legítima tiene *fan-in* igual que la mula: recibe de muchas personas
distintas. Si la decisión dependiera de esa señal, bloquearíamos al comercio.
Lo único que las separa es que la mula **reenvía el 91% en menos de 2 horas** y
la bodega **no reenvía nada**. Por eso `esMulaProbable()` exige el par
`fan_in + reenvio_rapido`: fan-in solo no basta.

**CU-03 es el diferencial.** Lo que aprendió el caso de Rosa protege a Jorge
sin investigar de nuevo y sin gastar una sola llamada de modelo.

> **5 llamadas de IA en total**, y Jorge cuesta 0: ese es el ahorro que produce
> la Memoria (`/api/stats` lo estima en 1.5 llamadas: lo que costó investigar
> M-01 antes). Sin `ANTHROPIC_API_KEY` el runtime corre en modo simulado
> (determinista) y cuenta las llamadas que gastaría con el modelo real, así el
> embudo del demo es honesto en ambos modos.

---

## Estructura

```
app/page.tsx          pantalla de dos paneles (components/demo-dashboard.tsx)
app/api/**            route handlers (ver docs/work/API.md)
lib/
  contracts/          esquemas zod y firmas compartidas entre los dos devs
  data/               seed.json determinista + repositorio
  rules/level0.ts     6 señales, puntajes del doc 19 §2
  policy/engine.ts    P1–P10, determinista
  memory/store.ts     veredictos validados por un humano, expiran a 90 días (archivo opcional)
  evidence/ledger.ts  ids E-xx emitidos por el sistema
  analytics/          fan-in, reenvío rápido, estructuración, ciclos, canales…
  cases/              objeto Caso + timeline + contador de IA; resumen para el feed
  observability/      métricas del doc 14 (TTPA, trazabilidad, E6) + registro
  juego/              partidas anónimas del demo jugable y su resumen (DEMO_JUEGO §6)
  seguridad/token.ts  token del operador (solo si hay DEMO_TOKEN)
  pipeline.ts         orquestación
  agents/             agentes con LLM (Tony_dev)
scripts/
  seed.ts             genera los datos
  demo.ts             los 5 casos de uso en consola
  servidor.ts         la laptop como servidor del demo
tests/                410 tests
```

---

## Sobre los sesgos

Un sistema antifraude que puntúa a las personas por lo que *son*, en vez de por
lo que ocurre en la operación, discrimina. Es el error fácil de cometer cuando
se agregan señales «porque mejoran el score».

Las 6 señales del nivel 0 son todas propiedades de la **operación**:
beneficiario nuevo, monto atípico, dispositivo nuevo, cambio de SIM o clave,
llamada activa, horario atípico. Ninguna es un atributo de la persona.

`tests/rules/sin-sesgo.test.ts` lo hace cumplir y **falla** si alguien
introduce un atributo demográfico, de salud o socioeconómico en el modelo, en
los datos semilla o en el motor de reglas.

Donde el sistema sí modela algo del cliente —si puede responder ahora, por qué
canal— describe la **situación**, no a la persona: «app comprometida», «no
alcanzable». Nunca un diagnóstico inferido. Adaptar el canal, no penalizar la
identidad.

---

## Documentación

| Documento | Para qué |
|---|---|
| [docs/CASOS_DE_USO.md](docs/CASOS_DE_USO.md) | problema, actores y los 5 casos con sus criterios de aceptación |
| [docs/SOLUCION.md](docs/SOLUCION.md) | resumen visual de la solución |
| [docs/work/00_WORK_BLUEPRINT.md](docs/work/00_WORK_BLUEPRINT.md) | división del trabajo y contratos entre devs |
| [docs/work/API.md](docs/work/API.md) | **la API HTTP, para la Fase 2** |
| [docs/context/tony_dev/adaptive_financial_security_docs/](docs/context/tony_dev/adaptive_financial_security_docs/) | investigación: tesis, problema, diseño multiagente |

---

## Estado

**Backend completo y verificado**: datos, reglas, policy, memoria, ledger de
evidencia, analytics, observabilidad, pipeline, la API y los scripts de demo y
de servidor. 410 tests, typecheck y lint limpios, `next build` correcto, y la
secuencia del demo verificada por HTTP contra el build de producción.

**Listo para el demo jugable** (DEMO_JUEGO §9): feed en vivo
(`GET /api/cases`), alias anónimo por intento, movimientos en vivo, registro y
resumen de partidas, token de operador y Memoria que sobrevive a un reinicio.
Todo es opcional: sin activarlo, la API se comporta igual que antes.

**Métricas medidas, no supuestas** (`GET /api/stats`): TTPA, % de afirmaciones
del expediente con cita válida (12/12 en el demo), llamadas evitadas por la
Memoria (estimado), tasa de modo seguro y fricción. Ver la tabla «Cómo leer
las métricas» en [docs/work/API.md](docs/work/API.md) antes de mostrar una cifra.

**Agentes integrados**: el pipeline usa el orquestador de `lib/agents`
(Tony_dev). `npm run demo` da 8/8 con los agentes reales en modo simulado.

**Pendiente**: probar contra un LLM real (Ollama primero, luego Claude con
`ANTHROPIC_API_KEY`), confirmar si la entrega exige URL pública (si sí:
`npm run servidor -- --tunel`) y las pantallas del juego (celular y monitor).
