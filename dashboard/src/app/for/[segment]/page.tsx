import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingPage } from "@/components/marketing/LandingPage";
import { SEGMENTS, segmentBySlug, segmentCopy } from "@/components/marketing/segments";
import { marketingFontClass } from "@/app/marketingFonts";

export function generateStaticParams() {
  return SEGMENTS.map((segment) => ({ segment: segment.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ segment: string }>;
}): Promise<Metadata> {
  const { segment: slug } = await params;
  const segment = segmentBySlug(slug);
  if (!segment) return {};
  return {
    title: `${segment.name} · Scalers`,
    description: segment.sub,
  };
}

/** One template for Home services, Shop, and Other business. */
export default async function SegmentPage({ params }: { params: Promise<{ segment: string }> }) {
  const { segment: slug } = await params;
  const segment = segmentBySlug(slug);
  if (!segment) notFound();
  return (
    <div className={`${marketingFontClass} contents`}>
      <LandingPage
        copy={segmentCopy(segment)}
        examples={segment.examples}
        example={segment.example}
        cta={segment.cta}
      />
    </div>
  );
}
