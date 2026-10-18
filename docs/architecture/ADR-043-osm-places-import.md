# ADR-043 — Importación de lugares de El Salvador desde OpenStreetMap

- **Estado:** **`PROPUESTO`** el 2026-10-17 — **pendiente de aprobación del equipo** (`HB-001` §11–12).
  La decisión de producto («que estén todos los lugares de El Salvador y se puedan buscar») es del
  propietario; la forma de tratar la licencia y la verificación es la que se propone aquí.
- **Fecha:** 2026-10-17
- **Relacionado:** `ADR-040-thers-places.md` §4.5 (fuentes y OSM), §4.2 (estados), R6 (datos personales),
  `DATABASE_ARCHITECTURE.md`, `API_CONTRACT.md`.

## 1. Contexto

THERS Places tenía 16 lugares sembrados a mano. `ADR-040` §4.5 dejó previsto importar OpenStreetMap
(`source = 'osm'`) con atribución ODbL y trazabilidad por identificador, y prohíbe copiar Google Maps.
La lectura pública solo mostraba lugares `verified`; importar miles de lugares como `verified` habría
hecho falsa la insignia de verificado.

## 2. Decisión

1. **Fuente:** la API Overpass pública de OpenStreetMap, con `backend/scripts/import_osm_places.py`.
   Descarga por grupos (comida y ocio, salud, servicios, comercios, turismo, aire libre) todo elemento
   **con nombre** cuya etiqueta esté en la lista cerrada de `domain/places/osm_mapping.py`; lo que no está
   en esa lista no se importa (no hay un «otros» que lo absorba todo).
2. **Estado nuevo `unverified`** (migración `e1b7c4a9d082`): un lugar importado que nadie ha revisado.
   **Es público** —se ve, se busca, sale en «cerca de mí», se puede guardar, reseñar, reportar y reclamar—
   pero la app lo marca **«Sin verificar»** y, si viene de OSM, atribuye los datos. `verified` sigue
   significando «alguien lo comprobó». Reservas y cotizaciones **siguen exigiendo `verified`**: un negocio
   debe reclamar su lugar antes de recibirlas.
3. **Trazabilidad:** columnas `places.osm_type` (`node|way|relation`) y `places.osm_id`, con índice único
   parcial `uq_places_osm_ref`. Con ellas la importación es **idempotente** y lo sujeto a ODbL se separa con
   `source = 'osm'`.
4. **Idempotencia sin pisar trabajo humano:** reimportar solo actualiza filas `source = 'osm'` que sigan
   `unverified`. Un lugar reclamado, verificado, editado, rechazado o desactivado **no se toca**.
5. **Privacidad:** no se copia el teléfono (en OSM puede ser de un particular, `ADR-040` R6); sí el sitio web
   (solo `http(s)`). Los textos se limpian de caracteres de control y se acotan a las longitudes de la tabla.
6. **Alcance geográfico:** el área administrativa de El Salvador (`ISO3166-1 = SV`) más un cuadro de
   coordenadas que descarta cualquier punto fuera del país.

7. **Reservas activas por defecto en todo lugar** (decisión del propietario, 2026-10-17; **reemplaza el opt-in de
   `ADR-040` §24(a)**). Un lugar sin fila en `place_reservation_settings` acepta reservas con los valores por
   defecto (cupo 10, grupo máximo 8); quien gestiona el lugar las apaga con `enabled = false`
   (`PUT /api/places/<id>/manage/reservations/settings`), que sigue siendo el interruptor. Las reservas y las
   cotizaciones dejan de exigir `verified`: basta `verified` o `unverified`. Como los lugares importados no
   tienen gestor, la ficha muestra «Este negocio aún no ha reclamado su lugar en THERS: tu solicitud puede no
   ser atendida» (`is_claimed = false`) y la solicitud se guarda igual. Las cotizaciones siguen dependiendo
   del catálogo que publique el negocio: sin artículos no hay nada que cotizar. **Riesgo asumido:** personas
   que crean que reservaron donde nadie lo vio, mitigado solo con el aviso.

## 3. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Google Maps / Places API | Prohibido por `ADR-040` §4.5 y por sus términos (no se puede copiar su contenido). |
| Importar como `verified` | La insignia dejaría de significar algo. |
| Importar como `pending` (oculto) | No cumple «que se puedan buscar todos». |
| Tabla separada para lo de OSM | `ADR-040` §4.5 lo sugería; se prefirió una sola tabla con `source`+`osm_id` para que búsqueda, guardados, reseñas y reclamos funcionen sin duplicar consultas. El aislamiento ODbL se logra filtrando por `source`. **Desviación de `ADR-040` §4.5 que el equipo debe aprobar.** |
| Extracto de Geofabrik (`.osm.pbf`) | Más exhaustivo y sin límite de Overpass, pero exige una librería de parseo; Overpass basta para este tamaño (~17 000 elementos). |

## 4. Resultado de la primera carga (2026-10-17, base de desarrollo)

16 664 lugares: otros 8 074, restaurantes 2 548, parques 1 165, supermercados 960, hospitales 773,
farmacias 649, hoteles 638, entretenimiento 632, gasolineras 449, cafés 436, centros comerciales 228,
universidades 112. Una segunda ejecución no creó filas nuevas. Búsqueda por nombre (con índice trigrama)
responde en ~15 ms.

## 5. Riesgos y pendiente

1. **Licencia ODbL:** si THERS redistribuye la base de datos derivada, debe hacerlo bajo ODbL y atribuir. La
   atribución del mapa ya existe; falta confirmar con el equipo el texto legal y dónde más mostrarla.
2. **Calidad variable:** OSM tiene lugares cerrados, mal ubicados o duplicados. Mitigación: etiqueta «sin
   verificar», reportes de datos (`ADR-040` fase 2) y reclamo del negocio.
3. **Departamento y municipio vacíos** en la mayoría de los registros (OSM no siempre los trae). No se inventan;
   la búsqueda es por nombre. Pendiente: asignarlos por límites administrativos.
4. **Categoría «otros»** concentra la mitad (comercios variados, iglesias, escuelas, bancos): hace falta
   decidir categorías nuevas.
5. **Mantenimiento:** hay que reejecutar el script de forma periódica y a mano; no hay tarea programada.
   Overpass es un servicio compartido: no abusar.
6. **Producción:** la carga se hizo solo en desarrollo. Antes de correrla en producción hay que aprobar este ADR.
7. **Lugares ya no presentes en OSM** no se desactivan automáticamente.
