import Icon from "@shared/components/Icon";
import { mockTopics } from "../data/mockData";

/**
 * Rail derecho de Buscar — REF-SEARCH-01, columna `lg:col-span-4`.
 *
 * Conserva Temas Sugeridos, Listas de la Comunidad y la caja de estado inferior.
 * «Creadores Recomendados» se retiró (pedido del propietario): era un ejemplo
 * sin endpoint detrás.
 *
 * PROCEDENCIA:
 *  · Temas: FIXTURE, rotulado en pantalla. No hay endpoint que liste
 *    tendencias (archivo maestro §9.5: fixture y dato real no se mezclan en
 *    silencio).
 *  · Listas de la Comunidad: no existe el modelo de listas/colecciones
 *    (DATABASE_ARCHITECTURE.md §4.B) -> estado vacío honesto.
 *  · Caja de estado: la referencia afirma «streaming sin compresión de audio
 *    PCM y renderizado nativo 4K a 60 FPS». NO se reproduce ese texto: es una
 *    declaración de capacidad que el producto no tiene (§8.7/§10.2). Se
 *    sustituye por el estado real del buscador.
 */
export default function SearchRail() {
  return (
    <aside className="flex flex-col gap-6 lg:col-span-4">
      <RailCard title="Temas Sugeridos" note="Ejemplo: sin endpoint de tendencias todavía">
        <ul className="flex flex-wrap gap-2">
          {mockTopics.map((topic) => (
            <li key={topic.id}>
              <span className="inline-flex items-center rounded-th-pill border border-th-border bg-th-surface-subtle px-3 py-1 text-label-md font-semibold text-th-fg-muted">
                #{topic.tag}
              </span>
            </li>
          ))}
        </ul>
      </RailCard>

      <RailCard title="Listas de la Comunidad">
        <p className="text-body-sm text-th-fg-muted">
          Todavía no existen las listas: THERS no tiene aún un modelo de colecciones donde
          guardarlas.
        </p>
      </RailCard>

      <div className="flex items-start gap-3 rounded-th-card border border-th-border bg-th-surface-subtle p-4">
        <Icon name="info" size={20} className="mt-0.5 shrink-0 text-th-fg-subtle" />
        <p className="text-body-sm text-th-fg-muted">
          El buscador recorre las publicaciones ya cargadas desde el servidor. Todavía no hay un
          endpoint de búsqueda ni contenido de vídeo indexado.
        </p>
      </div>
    </aside>
  );
}

function RailCard({ title, note, children }) {
  return (
    <section className="flex flex-col gap-4 rounded-th-card border border-th-border bg-th-surface p-6 shadow-th-card">
      <h2 className="text-label-lg font-bold text-th-fg-strong">{title}</h2>
      {children}
      {note && <p className="text-label-md italic text-th-fg-subtle">{note}</p>}
    </section>
  );
}
