# ADR-045 — Tero habla (síntesis de voz)

- **Estado:** **`PROPUESTO`** el 2026-10-17 — pendiente de aprobación del equipo (`HB-001` §11–12). Pedido por el
  propietario («haz que Tero hable»). Sin migración, sin endpoint nuevo y sin dependencias nuevas.
- **Relacionado:** `ADR-041-tero-ai-assistant.md`, `ADR-042-voice-messages-and-tero-voice.md` §4 (dejó «que Tero responda
  hablando» como función aparte; este ADR la cubre).

## Decisión

1. **Tero lee en voz alta sus respuestas** con la síntesis de voz **del propio dispositivo**: `expo-speech` en la app
   (ya era dependencia, la usa la navegación de rutas) y `speechSynthesis` en la web. El texto no se envía a THERS ni a
   un servicio de voz contratado.
2. **Su voz.** Tero es un compañero pequeño, amable y vivaz, así que: español latinoamericano (prioridad El Salvador,
   luego México y el resto de la región antes que España), voz de red/mejorada si existe, tono `1.18` y ritmo `1.03`
   (algo más aguda y ágil que la normal, sin exagerar). Elección en `teroSpeech` (`pickVoice`), probada. Con la interfaz
   en inglés se elige una voz en inglés. No imita a ninguna persona.
3. **Qué se lee.** Solo las **respuestas de Tero**, nunca las tarjetas de confirmación ni lo que escribe la persona. El
   texto se limpia antes (sin Markdown, enlaces —«un enlace»—, emoji ni bloques de código) y se acota a 520 caracteres,
   cortando en un final de frase.
4. **Control.** **Encendido por defecto** (decisión del propietario) y se apaga con un interruptor visible en la
   conversación (app: «Voz: sí/no»; web: botón de altavoz) y en los ajustes de Tero. La preferencia se guarda por cuenta
   en la app (`speakReplies`) y en el navegador en la web (`thers.tero.speak`). Se calla al **enviar un mensaje, al
   empezar a dictar, al salir de la pantalla y al pasar la app a segundo plano**.
5. **Avatar.** Mientras habla, Tero mueve la boca (el estado `speaking` ya existía).

6. **Idioma (2026-10-17).** Tero **contesta en el idioma en que le escriben**: el prompt de sistema
   (`application/tero/prompt.py`) pide inglés si escriben en inglés, español si escriben en español, y, si mezclan,
   el idioma de la petición principal (ante la duda, español). Verificado a mano con el modelo real en cuatro casos.
   La voz lee **en el idioma de la respuesta**: `detectLanguage` (heurística local por palabras, sin enviar nada a
   ningún servicio) elige una voz en inglés o en español. Cada idioma tiene su propia voz elegible: en la app
   (`voiceId` / `voiceIdEn`) y en la web (`thers.tero.voice` / `thers.tero.voice.en`), con la misma lista ordenada por
   calidad y su frase de prueba. **No cubierto:** las tarjetas de acción y los textos fijos de la interfaz de la app
   móvil siguen en español; el dictado reconoce solo español en la app.

## Privacidad y accesibilidad

- La síntesis la hace el sistema. **Excepción conocida:** si la persona tiene una voz «de red» (p. ej. algunas voces de
  Google en Android o de Chrome), **el sistema** puede enviar el texto a su proveedor; THERS no lo controla. Las voces
  locales no salen del dispositivo.
- Audio inesperado puede molestar en público: por eso el interruptor está siempre a la vista y se calla al enviar.
- No sustituye al lector de pantalla: las respuestas siguen anunciándose por `aria-live`/`accessibilityLiveRegion`.

## Riesgos / pendiente

1. La calidad depende de las voces instaladas; en un teléfono sin voz en español usa la voz por defecto del sistema.
2. Chrome de escritorio ignora `pitch` en sus voces de Google: ahí Tero suena más neutra.
3. No se ha probado con lectores de pantalla ni en iOS.
4. Falta añadir a la política de privacidad la nota de las voces de red.
