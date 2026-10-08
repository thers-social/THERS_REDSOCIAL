import { useLanguage } from "@shared/i18n";

/**
 * Filtro por categoría. `categories` viene del backend (`GET /api/places/categories`); si
 * todavía no cargó o falló, solo se muestra "Todas": el filtro es opcional y la página sigue
 * funcionando.
 */
export default function CategoryChips({ categories, value, onChange }) {
  const { t } = useLanguage();
  const chip = (active) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
      active
        ? "border-brand bg-brand text-on-brand"
        : "border-line dark:border-line-dark bg-surface dark:bg-surface-dark text-ink dark:text-ink-dark hover:border-brand-soft-strong"
    }`;

  return (
    <div role="group" aria-label={t("places.filters.categoryAria")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button type="button" aria-pressed={!value} className={chip(!value)} onClick={() => onChange("")}>
        {t("places.filters.all")}
      </button>
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          aria-pressed={value === category.slug}
          className={chip(value === category.slug)}
          onClick={() => onChange(value === category.slug ? "" : category.slug)}
        >
          {category.name}
        </button>
      ))}
    </div>
  );
}
