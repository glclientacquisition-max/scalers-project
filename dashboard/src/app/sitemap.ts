import type { MetadataRoute } from "next";
import { configuredSiteHost } from "@/lib/adminHost";
import { SEGMENTS } from "@/components/marketing/segments";

/** Public marketing URLs. Desk and pay routes stay off the sitemap. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = `https://${configuredSiteHost()}`;
  const paths = ["/", "/pricing", "/for", ...SEGMENTS.map((segment) => `/for/${segment.slug}`)];
  return paths.map((path) => ({
    url: path === "/" ? `${base}/` : `${base}${path}`,
    lastModified: new Date(),
  }));
}
