# API HTTP — contrato para la Fase 2 (frontend)

> Backend de Ale_dev. Esta es la superficie que consumirá la pantalla de dos
> paneles de la [Fase 2](00_WORK_BLUEPRINT.md#7-fase-2--frontend-por-asignar).
>
> Todos los ejemplos de esta página son **respuestas reales** capturadas del
> servidor, no inventadas. Los datos son sintéticos (ver `/api/health`).

**Base local:** `http://localhost:3000`
**Formato:** JSON en cuerpo y respuesta.
**Autenticación:** ninguna por defecto. Si el servidor corre con `DEMO_TOKEN`
(al exponerlo por red o túnel), las tres acciones del operador —reiniciar el
demo, confirmar una mula y borrar partidas— exigen la cabecera
`x-demo-token`; sin ella responden `401`. Todo lo demás sigue abierto: los
jugadores transfieren sin token.

---

## 1. El objeto que importa: `Caso`

Casi todos los endpoints devuelven un `Caso`. **La consola del analista y el
panel del cliente son dos vistas de este mismo objeto** (doc 19 §6), así que el
frontend no necesita nada más para pintar ambos paneles.

```ts
interface Caso {
  id: string;                   // 'CASO-0001'
  puerta: 'transferencia' | 'alerta_aml';
  transaccion: { origen, destino, monto, moneda: 'PEN' };
  nivel0: { senales: string[]; score: number; atajo?: 'P1' | 'P2' };
  evidencia: Array<{ id: string; fuente: string; dato: unknown }>;
  salidas: { coordinador?; guardian?; detective?; auditor? };
  decision?: { accion: Decision; regla: 'P1'..'P10'; t: string };
  timeline: Array<{ t: string; actor: string; evento: string; detalle?: unknown }>;
  ia: { llamadas: number; tokens: number; costo_estimado: number };
}
```

`decision.accion` es uno de:

| Acción | Significado para el frontend |
|---|---|
| `PERMITIR` | el dinero sale; no hay nada que mostrar al cliente |
| `VERIFICAR` | cooldown + verificación: pedir confirmación por canal seguro |
| `PAUSAR` | el dinero queda retenido hasta verificación |
| `ESCALAR` | retenido **y** en cola del analista |

**Qué pintar con qué:**

- 📱 **panel del cliente** → `transaccion`, `decision.accion`, y los mensajes
  del Guardián (ver §5);
- 🖥️ **consola del analista** → `timeline` (en vivo), `salidas.auditor`
  (expediente con citas), `evidencia` (el detalle de cada cita), `decision.regla`;
- 📊 **embudo y contador de IA** → `ia` por caso, y `/api/stats` para el total.

### `timeline` — el orden es significativo

Secuencia real de un caso de CU-01:

```
caso_creado → nivel0_evaluado → pausa_preventiva → plan
→ estado_usuario → riesgo_destino → expediente → decision
```

`pausa_preventiva` aparece **antes** de `plan`: el dinero se retiene antes de
consultar a cualquier agente, así la latencia del modelo no expone fondos
(TTPA ≈ 0). Si el frontend quiere mostrar "tu dinero ya está protegido", ese
es el evento que lo habilita, no `decision`.

### `evidencia` — cada cita del expediente se puede abrir

Las `fuente` posibles son las de AGENT_PLAYBOOKS §6: `perfil_cuenta`,
`fan_in`, `reenvio_rapido`, `estructuracion`, `ciclos`, `listas_riesgo`,
`guardian_respuesta`.

```json
{
  "id": "E-01",
  "fuente": "perfil_cuenta",
  "dato": { "cuenta": "M-01", "banco_propio": true, "antiguedad_dias": 8, "tipo": "desconocido" }
}
```

Cada afirmación del Auditor cita uno o más de estos ids. **Los ids los emite el
sistema, nunca el modelo**, así que una cita a un id inexistente sería una
alucinación detectada — por eso vale hacerlas clickeables.

---

## 2. `GET /api/health`

Salud del servicio y confirmación de que los datos son simulados.

```json
{
  "ok": true,
  "servicio": "adaptive-financial-security",
  "t": "2026-10-17T22:19:38.431Z",
  "agentes": "simulado",
  "datos": {
    "cuentas": 46, "clientes": 3, "movimientos": 200, "movimientos_en_vivo": 0,
    "nota": "DATOS 100% SINTÉTICOS, generados por scripts/seed.ts..."
  },
  "modos": { "movimientos_en_vivo": false, "token_operador": false, "memoria_persistente": false },
  "memoria": { "veredictos": 0, "carga": { "cargados": 0, "descartados": 0, "apartado": null } }
}
```

`modos` es lo que el operador revisa antes de presentar (§12). Dice **si** hay
token de operador, nunca cuál es. `memoria.carga` informa cuántos veredictos se
recuperaron del archivo al arrancar y cuántos se descartaron (R10 se vuelve a
exigir al cargar).

`agentes` es `"claude"` si hay `ANTHROPIC_API_KEY` real, o `"simulado"` si
corre el LLM determinista. En modo simulado el contador de IA **sí** cuenta las
llamadas que gastaría con el modelo real, así el embudo es honesto en ambos
modos.

> Conviene mostrar `datos.nota` en algún lugar visible de la UI. Es un requisito
> del Definition of Done: todo dato marcado como simulado.

---

## 3. `POST /api/transfers` — Puerta A

Evalúa una transferencia y devuelve el `Caso` completo. **`201 Created`.**

```json
{
  "transaccion": { "origen": "C-ROSA", "destino": "M-01", "monto": 4800, "moneda": "PEN" },
  "contexto": {
    "dispositivo_nuevo_24h": false,
    "cambio_sim_o_clave_72h": false,
    "llamada_activa_o_acceso_remoto": true,
    "horario_atipico": false
  },
  "respuestaCliente": "sí"
}
```

`contexto` son señales que **reporta el canal del banco**, no inferencias sobre
la persona. Todas opcionales; lo que no se envía se deriva de los datos
(beneficiario nuevo, monto vs. promedio de 90 días).

`respuestaCliente` es opcional y existe para guionar el demo. En un flujo real,
la respuesta llega por `/api/cases/[id]/guardian/reply`.

**Respuesta (recortada), caso de Rosa:**

```json
{
  "id": "CASO-0001",
  "puerta": "transferencia",
  "nivel0": {
    "senales": ["beneficiario_nuevo", "monto_atipico", "llamada_activa"],
    "score": 7
  },
  "salidas": {
    "detective": {
      "riesgo_destino": "alto",
      "tipologias": ["fan_in", "reenvio_rapido", "estructuracion"],
      "hipotesis": "cuenta de paso (mula) en cadena de layering",
      "cadena": ["M-01", "M-02", "M-03"],
      "evidencia": ["E-01", "E-02", "E-03", "E-04"]
    },
    "guardian": {
      "estado_usuario": "manipulacion_probable",
      "senales_manipulacion": ["guiado_por_telefono"],
      "canal_usado": "app",
      "evidencia": ["E-05"]
    }
  },
  "decision": { "accion": "ESCALAR", "regla": "P4", "t": "..." },
  "ia": { "llamadas": 0, "tokens": 0, "costo_estimado": 0 }
}
```

**Errores:** `400` con `{ error, detalle }` si el cuerpo no valida.

**`alias`** (opcional, modo juego): el apodo del jugador que hace el intento,
p. ej. `"alias": "Zorro"`. Se asocia al caso **al crearlo**, así el monitor lo
muestra mientras los agentes todavía trabajan. Es anónimo por diseño
(DEMO_JUEGO §8): `400` si parece un correo, un teléfono (7 o más dígitos) o un
enlace, o si pasa de 24 caracteres. No forma parte del `Caso`: aparece en
`GET /api/cases`. `POST /api/alerts` lo acepta igual.

---

## 4. `POST /api/alerts` — Puerta B (AML)

Una alerta sobre una cuenta, sin cliente al otro lado. **No pasa por el
Guardián** y produce expediente igual. **`201 Created`.**

```json
{ "cuenta": "M-01", "motivo": "fan-in con reenvío inmediato" }
```

En la respuesta, `puerta` es `"alerta_aml"` y `salidas.guardian` viene
`undefined`. La regla aplicada suele ser **P5**: con destino de riesgo alto y
sin cliente a quien preguntar, se escala.

**Errores:** `400` si `cuenta` falta, está vacía o es solo espacios; `404` si
la cuenta no existe en los datos. La alerta viene del monitoreo del propio
banco sobre sus cuentas: una cuenta desconocida es una entrada inválida, no un
caso (antes se abría el caso y la falta de datos terminaba en PERMITIR).

---

## 5. `GET /api/cases` — feed en vivo

Casos recientes, **del más nuevo al más viejo**, con un resumen para leer a
5 metros (DEMO_JUEGO §5). `?limite=N` (1–100, por defecto 50; `400` fuera de
rango). Respuesta real:

```json
{
  "total": 3,
  "casos": [
    {
      "id": "CASO-0003", "puerta": "transferencia", "alias": "Ana",
      "t": "2026-10-18T02:08:14.576Z",
      "origen": "C-JORGE", "destino": "M-01", "monto": 2200,
      "score": 4, "senales": ["beneficiario_nuevo", "monto_atipico"],
      "decision": { "accion": "ESCALAR", "regla": "P1" },
      "pausa_preventiva": false, "resuelto_por_memoria": true,
      "esperando_cliente": false, "llamadas_ia": 0, "ttpa_ms": 0,
      "actores": ["memoria"]
    },
    {
      "id": "CASO-0002", "puerta": "alerta_aml", "alias": "Jurado",
      "t": "2026-10-18T02:08:13.900Z",
      "origen": "monitoreo", "destino": "M-01", "monto": 1,
      "score": 5, "senales": ["alerta_aml"],
      "decision": { "accion": "ESCALAR", "regla": "P5" },
      "pausa_preventiva": true, "resuelto_por_memoria": false,
      "esperando_cliente": false, "llamadas_ia": 1, "ttpa_ms": 0,
      "actores": ["coordinador", "detective", "auditor"]
    }
  ]
}
```

En una **alerta AML** (`puerta: "alerta_aml"`), `origen: "monitoreo"` y
`monto: 1` son de relleno: no hay una transferencia detrás. El monitor debe
mostrar la cuenta alertada, no «S/1».

**`actores`** son los agentes en el orden en
que aparecen en el timeline: es lo que el monitor «enciende». Un intento a una
mula confirmada muestra solo `["memoria"]`, el atajo sin IA de CU-03.
`esperando_cliente` es `true` cuando el Guardián preguntó y nadie respondió
todavía. El detalle completo sigue en `GET /api/cases/[id]`.

---

## 5b. `GET /api/cases/[id]`

Estado del caso. **Es el endpoint de polling** (blueprint §2: cada 1 s).

Devuelve el mismo `Caso`. `404` si no existe.

```bash
curl localhost:3000/api/cases/CASO-0001
```

> Para el timeline en vivo, basta comparar `timeline.length` entre respuestas.
> No hay SSE ni websockets en el MVP, a propósito.

---

## 6. `POST /api/cases/[id]/guardian/reply`

El cliente responde al Guardián. **Devuelve el `Caso` actualizado**, con la
decisión recalculada si la conversación cerró.

```json
{ "texto": "sí" }
```

`texto: ""` significa **el cliente no respondió a tiempo**. El texto se trata
como dato, nunca como instrucción para un modelo (doc 15, R5).

### Mientras el cliente no responde, el dinero queda retenido (P7)

Si el Guardián hizo una pregunta y todavía no hay respuesta, la decisión es
**`PAUSAR` por P7** («esperando la respuesta del cliente»), salvo que el
destino sea de riesgo alto, que escala por P5. Antes, con un destino sin
tipologías, la decisión era `PERMITIR P8` con la pregunta en pantalla: un
«falso banco» hacia cualquier cuenta que no fuera M-01 pasaba. Cuando el
cliente responde, `/guardian/reply` vuelve a decidir.

«No sé», «no recuerdo» o «no estoy segura» se clasifican como **incierta**, no
como «no»: tres respuestas así terminan en `sin_respuesta` → P7, nunca en
`confirmado_seguro`.

### El Guardián es multiturno

`POST /api/transfers` abre la conversación y **deja la pregunta pendiente**: no
responde por el cliente. El flujo es:

```
POST /api/transfers
  → timeline: evento `pregunta` con el texto a mostrar
  → salidas.guardian ausente
  → decision: ESCALAR / P5   ← el dinero YA está retenido

POST /api/cases/[id]/guardian/reply  { "texto": "sí" }
  → salidas.guardian: { estado_usuario: "manipulacion_probable",
                        senales_manipulacion: ["guiado_por_telefono"] }
  → decision: ESCALAR / P4   ← decisión refinada
```

**Lo que importa para la UI:** la protección no espera la respuesta. Ya en la
primera llamada el caso está escalado por P5; la respuesta del cliente solo
precisa el diagnóstico. Si el panel muestra «tu dinero está protegido», puede
hacerlo desde el evento `pausa_preventiva`, sin esperar nada.

El guion tiene **máximo 3 preguntas**. Si el cliente calla las tres veces, la
conversación cierra en `sin_respuesta` y la decisión pasa a P4 — el silencio no
libera dinero, y llamar de nuevo no cambia el resultado:

| Llamada | `salidas.guardian` | `decision` |
|:-:|---|---|
| 1 con `""` | pendiente, nueva pregunta | ESCALAR / P5 |
| 2 con `""` | pendiente, nueva pregunta | ESCALAR / P5 |
| 3 con `""` | `sin_respuesta` | ESCALAR / **P4** |
| 4 con `""` | `sin_respuesta` | ESCALAR / P4 |

Para pintar el chat, los eventos `pregunta` del `timeline` traen cada texto en
`detalle.mensaje`, y las respuestas quedan como evidencia con fuente
`guardian_respuesta`.

**Clasificación:** las respuestas de hasta 4 palabras (`sí`, `no`, `claro`,
`para nada`…) las resuelve una tabla determinista; las frases más largas las
clasifica el modelo. Botones de respuesta corta hacen el demo más predecible,
pero el texto libre también funciona.

**Errores:** `400` si falta `texto`; `404` si el caso no existe.

## 7. `POST /api/cases/[id]/verdict`

El analista confirma o descarta. **Es el único camino hacia la Memoria.**

```json
{ "veredicto": "mula_confirmada", "validado_por": "analista_01" }
```

`veredicto` ∈ `mula_confirmada` | `descartada`. `validado_por` es
**obligatorio y no vacío**: sin un humano, nada entra a la Memoria (doc 15, R10).

```json
{
  "caso": "CASO-0003",
  "veredicto": {
    "cuenta": "M-01", "veredicto": "mula_confirmada",
    "validado_por": "analista_01",
    "fecha": "2026-10-17", "expira": "2027-01-15",
    "expediente": "CASO-0003", "apelacion_abierta": false
  }
}
```

**Errores:** `400` si falta `validado_por` o es solo espacios (no identifica a
ningún humano, R10), o si la Memoria rechaza el veredicto; `404` si el caso no
existe. En todos los `400`, nada entra a la Memoria. Con `DEMO_TOKEN`, `401`
sin la cabecera `x-demo-token`; se comprueba **antes** que el `404`, así sin
token no se revela si un caso existe.

Después de esto, una transferencia nueva al mismo destino se pausa por **P1 con
0 llamadas de IA** (CU-03). Es el momento más fuerte del demo: conviene que la
UI lo muestre explícitamente.

### 7b. `/api/cases/[id]/nota` — nota de revisión del analista (Atomic Memory, opcional)

El operador deja una nota corta sobre la **cuenta destino** del caso; el
próximo caso a esa cuenta la muestra en `/monitor`. Es contexto para el
analista: **no es evidencia, no entra al `Caso` y no cambia la decisión**
(P1 sigue saliendo solo de la Memoria de mulas de §7).

| Método | Cuerpo | Respuesta |
|---|---|---|
| `GET` | — | `{ activa: true, cuenta, nota: { id, cuenta, texto, caso, revisada_en } \| null }` |
| `PUT` | `{ "texto": "…" }` (1–280 caracteres) | `{ activa: true, guardada: true, nota }` — guarda o **corrige** (una nota por cuenta) |
| `DELETE` | — | `{ activa: true, borrada: true }`; `404` si no había nota |

Se activa solo con `ATOMICMEMORY_API_URL`, `ATOMICMEMORY_API_KEY` **y**
`DEMO_TOKEN`; si falta algo, `GET` responde `{ activa: false, motivo }` y
`PUT`/`DELETE` `409`. Exige `x-demo-token` (`401` antes que el `404`). El
sujeto de Atomic Memory (`user_id`) se deriva del token del operador en el
servidor: nunca viene del pedido y no se usa `session_id`. Otro token ve otras
notas.

Una falla de Atomic Memory (error, timeout de 2,5 s, redirección, respuesta
mayor a 256 KB o con forma inesperada) responde `502` y **nunca** `guardada` o
`borrada`: se informa guardada solo si la nota se relee con el mismo texto, y
borrada solo si Core responde `{ success: true }` y la nota ya no aparece.

Wire (docs.atomicstrata.ai): `POST /v1/memories/ingest/quick` verbatim con
`metadata.externalId = afs-nota-cuenta:<cuenta>` (re-ingerir corrige en su
lugar), `GET /v1/memories/by-external-id/:id?user_id=` y
`DELETE /v1/memories/:id?user_id=`.

---

## 8. `GET /api/stats`

Embudo, consumo de IA y métricas del doc 14, para el panel de métricas.
Respuesta real tras la secuencia del demo (en modo simulado; los `ms` varían):

```json
{
  "transacciones_evaluadas": 6,
  "sospechosas": 5,
  "con_llamadas_de_ia": 4,
  "llamadas_de_ia_totales": 5,
  "costo_estimado_total": 0,
  "por_regla": { "P4": 1, "P5": 1, "P1": 1, "P8": 1, "P7": 1, "P2": 1 },
  "mulas_en_memoria": 1,
  "nota_datos": "DATOS 100% SINTÉTICOS...",
  "metricas": {
    "eficiencia_ia": {
      "pct_transacciones_con_ia": 0.667,
      "llamadas_por_caso_con_ia": 1.25,
      "tokens_totales": 0,
      "casos_resueltos_sin_ia": 2,
      "resueltos_por_memoria": 1,
      "hit_rate_memoria": 0.167,
      "llamadas_evitadas_por_memoria": {
        "estimado": 1.5,
        "casos_p1": 1,
        "casos_p1_con_base": 1,
        "base": "por cada caso P1: promedio de llamadas de IA de los casos previos al mismo destino"
      }
    },
    "modo_seguro": { "casos_con_falla_de_agente": 0, "decididos_por_p10": 0, "tasa_modo_seguro": 0 },
    "friccion": {
      "permitidos": 2, "retenidos": 4, "tasa_de_retencion": 0.667,
      "por_accion": { "ESCALAR": 3, "PERMITIR": 2, "PAUSAR": 1 },
      "preguntas_al_cliente": 1
    },
    "trazabilidad": {
      "expedientes": 3, "expedientes_con_evidencia_completa": 3,
      "afirmaciones": 12, "afirmaciones_con_cita_valida": 12,
      "pct_afirmaciones_citadas": 1, "citas_inexistentes": 0
    },
    "ttpa": {
      "con_pausa_preventiva": { "casos": 3, "p50_ms": 0, "max_ms": 2 },
      "sin_pausa_preventiva": { "casos": 1, "p50_ms": 0, "max_ms": 0 },
      "nota": "ms del proceso que corrió; en modo simulado no incluye la latencia de un modelo real"
    }
  },
  "registro_reciente": [
    { "tipo": "agente", "t": "...", "caso": "CASO-0001", "agente": "detective",
      "llamadas": 0, "tokens": 0, "ms": 0, "resultado": "ok" },
    { "tipo": "decision", "t": "...", "caso": "CASO-0001", "regla": "P4",
      "accion": "ESCALAR", "degradado": false, "llamadas_ia_del_caso": 2 }
  ]
}
```

Las claves de primer nivel de antes no cambiaron; `metricas` y
`registro_reciente` son nuevas (`lib/observability/`).

**Cómo leer las métricas** (para no mostrar un número engañoso):

| Campo | Qué es | Cuidado |
|---|---|---|
| `null` en cualquier cociente | no hay casos para medirlo | no es 0: mostrar «—» |
| `pct_transacciones_con_ia` | casos que gastaron IA / total | los 6 casos del demo se eligieron por ser sospechosos: **no** es el % de una población real |
| `llamadas_evitadas_por_memoria` | **estimación** E6: por cada P1, lo que costó investigar ese mismo destino antes | mostrar siempre con la palabra «estimado»; `null` si no hubo investigación previa comparable |
| `trazabilidad.citas_inexistentes` | citas a un `E-xx` que no existe en el caso | es la alucinación detectable; debería ser 0 |
| `ttpa.con_pausa_preventiva` | ms entre que llega la transacción y la pausa | mide esta capa, no la latencia de un LLM real |
| `friccion.tasa_de_retencion` | decisiones que retienen dinero | **no** es tasa de falsos positivos: el caso no sabe si era fraude de verdad. Esa cifra sale de los evals (E7) |

**`registro_reciente`** son las últimas 20 entradas del registro del doc 19
§9: una por agente que corrió (llamadas, tokens, latencia, `ok`/`error`) y una
por decisión. **No contiene texto del cliente** ni atributos de la persona: los
campos son una lista cerrada y un test lo verifica.

---

## 9. `POST /api/demo/reset`

Vacía casos, Memoria (también su archivo, si hay persistencia), registro y
movimientos en vivo para repetir el demo desde cero. Sin cuerpo. Con
`DEMO_TOKEN`, `401` sin la cabecera.

```json
{ "ok": true, "reiniciado": true }
```

**No borra las partidas del juego** (§12): el reset se hace antes de presentar
y se llevaría los datos de validación del evento.

---

## 10. Notas de estado para el frontend

**El estado vive en memoria del proceso.** No hay base de datos (blueprint §2),
así que un reinicio del servidor borra casos y Memoria (salvo con
`--persistir`, §12). Por eso el demo corre en **un solo proceso continuo**
(`npm run servidor`) y **no en serverless**: en Vercel cada instancia tendría su
propio estado y el acto de Jorge fallaría al azar
([INFRA_Y_ORQUESTACION](../context/tony_dev/INFRA_Y_ORQUESTACION.md) §4).
Celulares y monitor ven los mismos casos porque hablan con el mismo proceso.

**Los ids son secuenciales por proceso** (`CASO-0001`, `CASO-0002`…). No
asumir que un id sobrevive un reinicio.

**Toda decisión trae su regla.** Nunca mostrar una acción sin su `regla`: la
explicabilidad es un criterio de aceptación de los tres casos de uso *must*.

---

## 11. Verificación rápida

```bash
npm run dev          # servidor en :3000
npm run demo         # los 5 casos de uso en consola, con sus reglas
npm test             # 426 tests
npm run typecheck
```

El script `npm run demo` recorre CU-01 a CU-05 e imprime decisión, regla,
evidencia y consumo de IA de cada caso. Es la forma más rápida de ver qué debe
devolver la API antes de escribir la UI.

---

### Con el modelo real, el expediente llega después

Con `agentes: "claude"`, `POST /api/transfers`, `/api/alerts` y
`/guardian/reply` responden **con la decisión, sin esperar al Auditor** (Opus
tarda varios segundos). El timeline trae `expediente_en_curso`, y
`salidas.auditor` aparece en un `GET /api/cases/[id]` posterior: el polling de
1.5 s del frontend ya lo resuelve. En modo simulado se espera al Auditor como
siempre. `AUDITOR_DIFERIDO=1|0` fuerza un modo u otro.

---

## 12. Modo juego y servidor del demo

Lo que el demo jugable necesita del backend (DEMO_JUEGO §9). Todo es
**opcional**: sin las variables, la API se comporta exactamente como en las
secciones anteriores.

### Levantar el servidor

```bash
npm run servidor                          # localhost:3000, demo limpio
npm run servidor -- --red --juego         # celulares por Wi-Fi + movimientos en vivo
npm run servidor -- --red --juego --persistir --tunel
```

| Flag | Efecto |
|---|---|
| `--red` | escucha en `0.0.0.0` para los celulares. **Exige token** (lo genera si falta) |
| `--tunel` | imprime el comando de Cloudflare Tunnel. **Exige token**. No instala ni lanza nada |
| `--juego` | `MOVIMIENTOS_EN_VIVO=1` |
| `--persistir` | Memoria y partidas en `.datos/` (ignorada por git) y **no reinicia** al arrancar: sirve para recuperarse si el proceso se cae a mitad del demo |
| `--puerto N` · `--sin-build` | puerto (3000) · saltar `next build` |

Next corre **dentro** del proceso del script, sin procesos hijos. Si el puerto
está ocupado (un servidor anterior que quedó abierto), el script lo dice y
muestra cómo liberarlo. El operador abre la consola con `/?token=…`: el
frontend guarda el token en la pestaña y lo quita de la URL, para que no quede
a la vista en el proyector.

### Movimientos en vivo (`MOVIMIENTOS_EN_VIVO=1`)

Una transferencia **permitida** movió dinero: pasa a ser un movimiento de la
cuenta destino y alimenta su fan-in, y el caso registra el evento
`movimiento_registrado`. Una retenida (PAUSAR, VERIFICAR, ESCALAR) **no**: ese
dinero no llegó. Las alertas nunca mueven dinero. La semilla no se modifica; el
reset vuelve a ella.

> **Límite del diseño actual:** con 3 víctimas (Rosa, Jorge, Lucía), una mula
> *nueva* llega como mucho a 4 remitentes nuevos (el umbral es 5), y el
> Detective además exige reenvío rápido, que una mula del juego no hace en
> vivo. Así que una mula nueva **no se «quema» sola**. La escena funciona con
> M-01 (alerta → «Confirmar mula» → P1 para todos). Hay un test que fija este
> límite.

### `POST /api/juego/partidas`

Registra una partida al terminar. **`201`**. Dos formas, según `rol`:

```json
{
  "rol": "victima",
  "alias": "Ana",
  "ronda_a": { "cayo": true, "frustracion": 4 },
  "ronda_b": { "casos": ["CASO-0007"], "pausa_molesto": "un_poco" },
  "activaria": "si"
}
```

```json
{
  "rol": "atacante",
  "alias": "Zorro",
  "intentos": [
    { "caso": "CASO-0001", "tactica": "falso_familiar" },
    { "caso": "CASO-0005", "tactica": "falso_banco" }
  ],
  "idea": "probaría con montos aún más chicos"
}
```

- `frustracion`: 1 😌 … 5 😫. `pausa_molesto`: `no` · `un_poco` · `mucho`.
  `activaria`: `si` · `no` · `no_se`. `tactica`: `falso_banco` · `link_falso` ·
  `falso_familiar` · `app_falsa` · `duplicado_chip`. Máximo 5 intentos.
- **Los resultados los calcula el sistema:** lo robado y lo frenado salen de
  los casos reales. `400` si un caso no existe o aparece dos veces; `409` si
  ya está en otra partida. No se pueden inventar ni contar dos veces.
- Al registrar se **copian los hechos** de cada caso (acción, regla, monto,
  destino, hora de creación): la partida sobrevive al reset del demo. Un caso
  se identifica por **id + hora de creación**, no solo por el id: `CASO-0001`
  se recicla con cada reset y reinicio, y antes eso hacía que toda partida
  posterior fuera rechazada con `409`.
- **`ronda_b.casos` es solo para los intentos de estafa**, nunca para pagos
  legítimos: el resumen cuenta cualquier `PERMITIR` ahí como dinero perdido
  (E3). Si se mandara el pago a Don Pepe, saldría 100% de pérdida falsa.
- Anónimo: `alias` e `idea` rechazan correos, teléfonos y enlaces.

`GET /api/juego/partidas` las lista. `DELETE /api/juego/partidas` las borra
(acción del operador: con `DEMO_TOKEN`, exige el token).

### `GET /api/juego/resumen`

La tabla de validación de DEMO_JUEGO §6, calculada a partir de las partidas:

| Campo | Hipótesis | Qué es |
|---|---|---|
| `victima.h3_cayeron_ronda_a` | H3 | `{ n, pct }` que transfirieron en la ronda «Hoy» |
| `victima.e3_perdieron_ronda_b` | E3 | `{ n, pct }` con algún caso **permitido** en la ronda B |
| `victima.frustracion_ronda_a` | — | distribución 1–5 y **mediana** (es ordinal: no hay promedio) |
| `victima.friccion_pausa_molesto` | fricción | conteo `no` / `un_poco` / `mucho` |
| `victima.h5_activaria` | H5 | conteo y `pct_si` |
| `atacante.soles_robados` / `soles_intentados` | — | suma de montos permitidos / de todos |
| `atacante.por_tactica` | robustez | `{ intentos, logrados }` por carta |
| `atacante.h8_frenados_por_memoria` | H8 | intentos frenados por P1, sin IA |
| `limites` | — | los 4 límites que el doc pide decir en voz alta |

Siempre va el `n`. Sin partidas, los cocientes son `null`, no 0.

---

## 13. Salas EN VIVO (`/api/juego/salas`)

Multijugador del demo. Una sala tiene un código de 4 letras, vive en la RAM del
proceso y se limpia sola a las 2 h. Hay dos clases de sala:

| `juego` | Qué pasa | Quién califica |
|---|---|---|
| `real_o_estafa`, `pausa_o_pasa` | 8 rondas de cartas, todos responden la misma | el servidor, por acierto y rapidez |
| `banda` | **una sola fase de ataque**: todos atacan la capa a la vez | el **pipeline real** (cada golpe es un `Caso`) |

```
POST /api/juego/salas              { alias, pais, juego } → 201 { codigo, token }
GET  /api/juego/salas                                     → { salas: VistaSala[] }   (monitor)
GET  /api/juego/salas/[codigo]?alias=…                    → VistaSala
POST /api/juego/salas/[codigo]     { accion: … }          → VistaSala | ResultadoGolpe
```

El `token` es de quien crea la sala (empezar y reiniciar). No se muestra ni se
guarda: no es el `DEMO_TOKEN` del operador.

### `accion: 'golpe'` — LA BANDA

```jsonc
{
  "accion": "golpe",
  "alias": "ANA",
  "golpe": {
    "victima": "rosa",            // rosa | jorge | lucia
    "tactica": "falso_banco",     // falso_banco | link_falso | falso_familiar | app_falsa | duplicado_chip
    "destino": "M-01",            // M-01 | M-02 | M-03
    "monto": "todo",              // chico (300) | medio (1200) | todo (4800)
    "madrugada": false
  }
}
```

**El cliente manda ids, no una transferencia.** El servidor arma la operación
con el catálogo de `lib/juego/golpes.ts` (cuentas del seed, señales de cada
táctica) y la pasa por `evaluarTransferencia`, igual que `POST /api/transfers`.
Un golpe con una cuenta o un monto inventados es `400` y no llega al pipeline.

Respuesta `200`:

```jsonc
{
  "vista": { /* VistaSala, ya con el golpe contado */ },
  "golpe": {
    "caso": "CASO-0007", "alias": "ANA", "victima": "rosa", "tactica": "falso_banco",
    "destino": "M-01", "monto": 4800, "madrugada": false,
    "frenado": true, "accion": "ESCALAR", "regla": "P5", "llamadas_ia": 1,
    "puntos": 100, "descubrimiento": false, "t": 1792325434869, "orden": 7
  },
  "caso": { /* el Caso completo: señales, agentes, decisión */ }
}
```

| Código | Cuándo |
|---|---|
| `400` | el golpe no está en el catálogo |
| `403` | el alias no se unió a la sala |
| `404` | no existe la sala |
| `409` | la sala no es de LA BANDA, está fuera de la fase de ataque, se acabaron los 10 golpes, o es un golpe repetido |
| `429` | menos de 2 s desde el golpe anterior **de ese jugador** |
| `503` | el pipeline no pudo evaluar (el golpe no se cobra: se puede reintentar) |

### Puntaje de LA BANDA

| Resultado | Puntos | Por qué |
|---|---|---|
| Frenado | 100 | probar la capa también enseña |
| Hueco (el dinero habría salido) | 1000 | encontrar huecos **es** el objetivo |
| Primer hueco de la sala con esa táctica | +500 | el descubrimiento vale más que repetirlo |

El mismo golpe no se repite (hay que cambiar al menos una perilla), así que no
se puede moler un hueco conocido para subir en el ranking.

### `VistaSala.banda` (lo que proyecta el monitor)

```jsonc
{
  "golpes": 24, "frenados": 22, "huecos": 2,
  "ultimos": [ /* los 8 últimos GolpeRegistrado de la sala, el más nuevo primero */ ],
  "por_tactica": [ { "tactica": "falso_familiar", "intentos": 5, "huecos": 2 } ]
}
```

`mio.banda` agrega lo del jugador que consulta: `{ golpes, huecos, restantes, mios }`.

El orden del feed lo da `orden` (un contador por sala), no `t`: dos golpes del
mismo milisegundo quedarían empatados y el proyector mostraría un orden al azar.

### Fases y tiempos

| Fase | Dura | Nota |
|---|---|---|
| `espera` | hasta que el anfitrión inicia | se muestra el QR (`/play?sala=XXXX`) |
| `cuenta` | 3 s | |
| `ataque` | 150 s | solo en `banda` |
| `responder` / `revelar` | 10 s / 4,5 s por ronda | solo en salas de cartas |
| `fin` | — | podio; el anfitrión puede `reiniciar` |

`reiniciar` borra golpes, puntajes y descubrimientos, y vuelve a `espera`.
