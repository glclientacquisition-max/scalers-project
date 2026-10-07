"use client";

import { TrashIcon } from "@heroicons/react/24/outline";
import { ListRow } from "@/components/ui/ListRow";
import { IconButton } from "@/components/ui/IconButton";
import { catalogRowStamp } from "@/components/settings/catalog/catalogStamp";
import type { ProductItem } from "@/lib/productCatalog";
import type { ServiceItem } from "@/lib/servicesCatalog";

export function CatalogServiceListRow({
  service,
  index,
  onRemove,
}: {
  service: ServiceItem;
  index: number;
  onRemove: () => void;
}) {
  const preview = [service.price_range, service.notes].filter(Boolean).join(" · ") || "No price yet";
  return (
    <ListRow
      title={service.name.trim() || `Service ${index + 1}`}
      preview={preview}
      stamp={catalogRowStamp(service)}
      actions={
        <IconButton
          type="button"
          label={`Remove service ${index + 1}`}
          onClick={onRemove}
        >
          <TrashIcon className="h-5 w-5" />
        </IconButton>
      }
    />
  );
}

export function CatalogProductListRow({
  product,
  index,
  onRemove,
}: {
  product: ProductItem;
  index: number;
  onRemove: () => void;
}) {
  const preview = [product.price, product.category].filter(Boolean).join(" · ") || "No price yet";
  return (
    <ListRow
      title={product.name.trim() || `Product ${index + 1}`}
      preview={preview}
      stamp={catalogRowStamp(product)}
      actions={
        <IconButton
          type="button"
          label={`Remove product ${index + 1}`}
          onClick={onRemove}
        >
          <TrashIcon className="h-5 w-5" />
        </IconButton>
      }
    />
  );
}
