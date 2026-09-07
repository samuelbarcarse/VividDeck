import { R2_PUBLIC_URL } from "./env";

/**
 * Card art URLs point straight at R2's custom domain.
 *
 * Never route these through next/image: Vercel's optimizer is metered per
 * image, which would undo the entire reason for putting the art on R2.
 */
export function feedImage(imageKey: string): string {
  return `${R2_PUBLIC_URL}/${imageKey}/feed.webp`;
}

/** Also 600x825 — TCGdex has no larger source. Don't size the modal past that. */
export function detailImage(imageKey: string): string {
  return `${R2_PUBLIC_URL}/${imageKey}/detail.webp`;
}
