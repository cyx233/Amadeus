// Derives a TaskMaster tag name from a PRD filename. Each PRD parses into its
// own tag so a project can hold multiple separate task sets; "tag" is a hidden
// implementation detail — users only pick a PRD.
//
// TaskMaster tag names are lowercase alphanumeric with hyphens/underscores; no
// spaces or dots, and `master` is the reserved default. So: strip the .txt/.md
// extension, lowercase, replace anything outside [a-z0-9_-] with '-', collapse
// repeats, trim leading/trailing '-'. Empty or reserved results fall back to a
// safe name.
//
// Examples: "Feature X.md" -> "feature-x", "PRD.md" -> "prd", "prd.txt" -> "prd".

const PRD_EXTENSION = /\.(txt|md)$/i;
const MASTER_TAG = 'master';

export function prdNameToTag(fileName: string): string {
  const stem = (fileName || '').replace(PRD_EXTENSION, '');
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) return 'prd';
  // Never collide with the reserved default tag.
  if (slug === MASTER_TAG) return 'master-prd';
  return slug;
}
