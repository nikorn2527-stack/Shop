import { resolveProductArtwork } from "@shared/productIcons";

export function ProductArtwork({
  product,
}: {
  product: Parameters<typeof resolveProductArtwork>[0];
}) {
  const artwork = resolveProductArtwork(product);
  return artwork.imageUrl ? (
    <img src={artwork.imageUrl} alt="" />
  ) : (
    <span className="cell-thumb-fallback">{artwork.emoji}</span>
  );
}
