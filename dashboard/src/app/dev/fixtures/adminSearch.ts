import { businessHit, callHit, invoiceHit, numberHit, type CommandHit } from "@/lib/ops/searchView";

/** Synthetic ⌘K hits. Made-up businesses and numbers; no real data. */
export const ADMIN_SEARCH_HITS: CommandHit[] = [
  businessHit({ id: "t1", business_name: "Kilele Fitness", number: "+254 709 100 201", archived: false }),
  businessHit({ id: "t2", business_name: "Kilimani Dental Studio", number: "+254 709 100 233", archived: false }),
  businessHit({ id: "t3", business_name: "Kileleshwa Bakers", number: "pending:t3", archived: false }),
  businessHit({ id: "t4", business_name: "Kilifi Boat Tours", number: "+254 709 100 260", archived: true }),
  numberHit({ id: "n1", e164: "+254709100201", status: "assigned", tenant_id: "t1", business_name: "Kilele Fitness" }),
  numberHit({ id: "n2", e164: "+254709100288", status: "available" }),
  numberHit({ id: "n3", e164: "+254709100260", status: "assigned", tenant_id: "t4", business_name: "Kilifi Boat Tours", archived: true }),
  invoiceHit({ id: "i1", invoice_number: "SCL-2026-0172", status: "paid", tenant_id: "t1", business_name: "Kilele Fitness" }),
  invoiceHit({ id: "i2", invoice_number: "SCL-2026-0151", status: "issued", tenant_id: "t2", business_name: "Kilimani Dental Studio" }),
  invoiceHit({ id: "i3", invoice_number: "SCL-2026-0098", status: "void", tenant_id: "t4", business_name: "Kilifi Boat Tours", archived: true }),
  callHit({ id: "kil-7f3a91", business_name: "Kilele Fitness" }),
  callHit({ id: "kil-2c08d4", business_name: "Kilimani Dental Studio" }),
];
