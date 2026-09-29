"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { DESK_TENANT_COOKIE } from "@/lib/deskTenantCookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function switchDeskTenant(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") || "").trim();
  const user = await getAuthUser();
  if (!user || !tenantId) redirect("/home");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data?.tenant_id) redirect("/home");

  const jar = await cookies();
  jar.set(DESK_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/home");
}
