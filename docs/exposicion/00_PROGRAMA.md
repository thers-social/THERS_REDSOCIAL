# Exposición THERS — Programa general

Cada persona habla **una sola vez**. Duración total: ~42 minutos más preguntas.

| # | Quién | Contenido | Tiempo | Guion |
|---|---|---|---|---|
| 1 | Oscar Piche | Apertura y demo de todo lo funcional en la web | 13 min | `01_OSCAR.md` |
| 2 | Diego Medina | Backend completo y seguridad | 14 min | `02_DIEGO.md` |
| 3 | Fernando | Móvil Android, Handbook, conexión con el backend, servicios y estructura | 9 min | `03_FERNANDO.md` |
| 4 | Cristopher | DevOps, seguridad de la infraestructura, pendientes y cierre | 6 min | `04_CRISTOPHER.md` |

## Reglas de la exposición
1. **Nadie vuelve a hablar.** Lo que se omita en su turno no se dice después. Oscar anuncia el orden al empezar, para que nadie espere un «cierre» aparte.
2. **Se presenta solo lo que funciona.** Lo pendiente se declara como pendiente (lo cubre Cristopher al final). Nadie afirma que «todo está protegido» ni que hay moderación activa.
3. **Cifras:** las pruebas y rutas cambian. Verifíquenlas el mismo día (comando en cada guion).
4. **Nada de secretos en pantalla:** ni `.env`, ni claves, ni correos de usuarios reales. Usen cuentas de prueba.

## Cobertura: dónde se habla de cada tema
| Tema | Quién |
|---|---|
| Qué es THERS, equipo, forma de trabajo | Oscar |
| Todo lo que hace la web hoy | Oscar |
| Arquitectura del backend, flujo de una petición, base de datos, API, pruebas | Diego |
| Herramientas del backend (Postman y otras) | Diego |
| Seguridad y protección de las personas (núcleo) | Diego |
| App móvil Android | Fernando |
| Handbook | Fernando |
| Cómo el frontend se conecta con el backend | Fernando |
| Servicios usados, estructura, escalabilidad, documentación | Fernando |
| Seguridad del cliente (tokens, bundle) | Fernando |
| Entorno, despliegue, secretos | Cristopher |
| Lo que falta y siguientes pasos | Cristopher |

## Preparación previa (todos) — una semana antes
- [ ] Decidir qué ramas están fusionadas en `develop` el día de la demo (ver `docs/BRANCH_AND_PR_PLAN.md`). Solo se demuestra lo fusionado.
- [ ] Levantar el entorno completo en la máquina de la demo y probarlo una vez entero.
- [ ] Ensayo general cronometrado, con los cuatro, en el orden del programa.
- [ ] Teléfono con la app instalada, cargado y con datos o Wi-Fi.
- [ ] Plan B por turno (capturas o grabación corta) por si falla algo en vivo.

## Preguntas probables y quién responde
| Pregunta | Responde |
|---|---|
| ¿Cómo protegen las contraseñas y las sesiones? | Diego |
| ¿Hay moderación? ¿Y para menores? | Diego (hoy: reportes y prioridad; el panel está pendiente) |
| ¿Por qué solo mayores de 18? | Diego |
| ¿Cómo escala el código? | Fernando |
| ¿Dónde se despliega y cuánto cuesta? | Cristopher |
| ¿Qué falta para publicar? | Cristopher |
