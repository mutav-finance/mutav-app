/**
 * Document templates actually shipped under `public/templates/`. A template
 * link renders only for a file listed here, so a missing PDF is hidden rather
 * than served as a 404; `templates.test.ts` keeps this list equal to the
 * directory's contents.
 */
export const SHIPPED_TEMPLATE_FILES: ReadonlySet<string> = new Set<string>([]);

export function templateHref(documentKey: string): string | null {
  const file = `${documentKey}.pdf`;
  return SHIPPED_TEMPLATE_FILES.has(file) ? `/templates/${file}` : null;
}
