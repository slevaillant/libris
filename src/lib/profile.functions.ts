import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type UserProfile = {
  userId: string;
  displayName: string;
  librarianName: string;
  professionalContext: string | null;
  timezone: string;
  digestEnabled: boolean;
  digestEmail: string | null;
  digestTime: string;
  onboardingCompleted: boolean;
  topicsMd: string | null;
  topicsUpdatedAt: string | null;
};

export const getProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    return {
      userId: data.user_id,
      displayName: data.display_name,
      librarianName: data.librarian_name,
      professionalContext: data.professional_context,
      timezone: data.timezone,
      digestEnabled: data.digest_enabled,
      digestEmail: data.digest_email,
      digestTime: data.digest_time,
      onboardingCompleted: data.onboarding_completed,
      topicsMd: data.topics_md ?? null,
      topicsUpdatedAt: data.topics_updated_at ?? null,
    } as UserProfile;
  });

const updateProfileSchema = z.object({
  displayName:         z.string().min(1, "Name is required"),
  librarianName:       z.string().min(1).default("Lumen"),
  professionalContext: z.string().nullable().optional(),
  timezone:            z.string().default("Europe/Paris"),
  digestEnabled:       z.boolean().default(true),
  digestEmail:         z.string().email().nullable().optional(),
  onboardingCompleted: z.boolean().default(false),
});

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => updateProfileSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { error } = await supabase
      .from("user_profiles")
      .update({
        display_name:         data.displayName,
        librarian_name:       data.librarianName,
        professional_context: data.professionalContext ?? null,
        timezone:             data.timezone,
        digest_enabled:       data.digestEnabled,
        digest_email:         data.digestEmail ?? null,
        onboarding_completed: data.onboardingCompleted,
        updated_at:           new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
