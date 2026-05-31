import { z } from "zod";

// Review step has a single form input: the consent checkbox. No
// validation rules (boolean is always valid). Schema exists for
// consistency with profile and banking — gives review the same
// useForm + onSubmit shape, so the orchestrator's handler interface
// is uniform across all three steps.
export const reviewSchema = z.object({
  consentMarketing: z.boolean(),
});

export type ReviewFormValues = z.infer<typeof reviewSchema>;

export const REVIEW_FORM_DEFAULTS: ReviewFormValues = {
  consentMarketing: false,
};
