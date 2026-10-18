"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  PASSWORD_UPDATED_PATH,
  RECOVERY_COOKIE,
  newPasswordError,
  updatePasswordErrorMessage,
  type NewPasswordError,
} from "@/lib/passwordReset";

export type ResetState = { error?: string; field?: NewPasswordError["field"]; expired?: boolean };

export async function updatePasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  const invalid = newPasswordError(password, confirm);
  if (invalid) return { error: invalid.message, field: invalid.field };

  const jar = await cookies();
  if (!jar.get(RECOVERY_COOKIE)) return { expired: true, error: "This reset link has expired. Send yourself a new one." };

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return { error: "Couldn't save your new password. Try again in a few minutes." };
  }
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { expired: true, error: "This reset link has expired. Send yourself a new one." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const mapped = updatePasswordErrorMessage(error.message);
    return mapped.field ? { error: mapped.message, field: mapped.field } : { error: mapped.message };
  }
  jar.delete(RECOVERY_COOKIE);
  redirect(PASSWORD_UPDATED_PATH);
}
