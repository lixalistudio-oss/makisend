import { z } from "zod";
import {
  hasLineBreak,
  MAX_HTML_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TEMPLATE_EDITOR_JSON_LENGTH,
  MAX_TEMPLATE_SOURCE_LENGTH,
  MAX_TEMPLATE_VARIABLE_NAME_LENGTH,
  MAX_TEMPLATE_VARIABLE_VALUE_LENGTH,
  MAX_TEMPLATE_VARIABLES,
  MAX_TEXT_LENGTH,
} from "@/core/validation";

// Caps mirror send-email.dto: the rendered subject/text/html end up in a single
// Cloudflare Queue message (128 KB limit).
const EditorJson = z
  .string()
  .trim()
  .min(2, { message: "Editor content cannot be empty." })
  .max(MAX_TEMPLATE_EDITOR_JSON_LENGTH, {
    message: `Editor content must be at most ${MAX_TEMPLATE_EDITOR_JSON_LENGTH} characters.`,
  })
  .refine(
    (value) => {
      try {
        const parsed = JSON.parse(value) as { type?: unknown } | null;
        return Boolean(parsed && typeof parsed === "object" && parsed.type === "doc");
      } catch {
        return false;
      }
    },
    { message: "Editor content must be a valid TipTap document." },
  );

const Source = z
  .string()
  .trim()
  .min(1, { message: "React Email source cannot be empty." })
  .max(MAX_TEMPLATE_SOURCE_LENGTH, {
    message: `React Email source must be at most ${MAX_TEMPLATE_SOURCE_LENGTH} characters.`,
  });

const TemplateFormat = z.enum(["legacy", "react-email", "react-email-code"]);

export const CreateTemplateDto = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: "Template name is required." })
      .max(MAX_NAME_LENGTH, {
        message: `Template name must be at most ${MAX_NAME_LENGTH} characters.`,
      }),
    subject: z
      .string()
      .trim()
      .min(1, { message: "Subject is required." })
      .max(MAX_SUBJECT_LENGTH, {
        message: `Subject must be at most ${MAX_SUBJECT_LENGTH} characters.`,
      })
      .refine((value) => !hasLineBreak(value), {
        message: "Subject must not contain line breaks.",
      }),
    format: TemplateFormat.default("legacy"),
    editorJson: EditorJson.optional(),
    source: Source.optional(),
    html: z
      .string()
      .trim()
      .min(1, { message: "HTML content cannot be empty." })
      .max(MAX_HTML_LENGTH, {
        message: `HTML content must be at most ${MAX_HTML_LENGTH} characters.`,
      }),
    text: z
      .string()
      .trim()
      .min(1, { message: "Plain text body cannot be empty." })
      .max(MAX_TEXT_LENGTH, {
        message: `Plain text body must be at most ${MAX_TEXT_LENGTH} characters.`,
      }),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.format === "react-email" && !data.editorJson) {
      ctx.addIssue({
        code: "custom",
        path: ["editorJson"],
        message: "editorJson is required for react-email templates.",
      });
    }
    if (data.format === "react-email-code" && !data.source) {
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message: "source is required for react-email-code templates.",
      });
    }
  });

export type CreateTemplateDto = z.infer<typeof CreateTemplateDto>;

export const UpdateTemplateDto = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: "Template name cannot be empty." })
      .max(MAX_NAME_LENGTH, {
        message: `Template name must be at most ${MAX_NAME_LENGTH} characters.`,
      })
      .optional(),
    subject: z
      .string()
      .trim()
      .min(1, { message: "Subject cannot be empty." })
      .max(MAX_SUBJECT_LENGTH, {
        message: `Subject must be at most ${MAX_SUBJECT_LENGTH} characters.`,
      })
      .refine((value) => !hasLineBreak(value), {
        message: "Subject must not contain line breaks.",
      })
      .optional(),
    format: TemplateFormat.optional(),
    editorJson: EditorJson.nullable().optional(),
    source: Source.nullable().optional(),
    html: z
      .string()
      .trim()
      .min(1, { message: "HTML content cannot be empty." })
      .max(MAX_HTML_LENGTH, {
        message: `HTML content must be at most ${MAX_HTML_LENGTH} characters.`,
      })
      .optional(),
    text: z
      .string()
      .trim()
      .min(1, { message: "Plain text body cannot be empty." })
      .max(MAX_TEXT_LENGTH, {
        message: `Plain text body must be at most ${MAX_TEXT_LENGTH} characters.`,
      })
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.format === "react-email" && !data.editorJson) {
      ctx.addIssue({
        code: "custom",
        path: ["editorJson"],
        message: "editorJson is required for react-email templates.",
      });
    }
    if (data.format === "react-email-code" && !data.source) {
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message: "source is required for react-email-code templates.",
      });
    }
  });

export type UpdateTemplateDto = z.infer<typeof UpdateTemplateDto>;

// A variable value arrives as a plain scalar; numbers/booleans are common in
// API payloads (order ids, counts) so they are coerced to strings.
const VariableValue = z
  .union([z.string(), z.number(), z.boolean()])
  .transform((value) => String(value))
  .refine((value) => value.length <= MAX_TEMPLATE_VARIABLE_VALUE_LENGTH, {
    message: `Variable values must be at most ${MAX_TEMPLATE_VARIABLE_VALUE_LENGTH} characters.`,
  });

export const TemplateVariablesDto = z
  .record(
    z
      .string()
      .min(1, { message: "Variable names cannot be empty." })
      .max(MAX_TEMPLATE_VARIABLE_NAME_LENGTH, {
        message: `Variable names must be at most ${MAX_TEMPLATE_VARIABLE_NAME_LENGTH} characters.`,
      }),
    VariableValue,
  )
  .refine((variables) => Object.keys(variables).length <= MAX_TEMPLATE_VARIABLES, {
    message: `At most ${MAX_TEMPLATE_VARIABLES} variables are allowed.`,
  });

export const PreviewTemplateDto = z
  .object({
    variables: TemplateVariablesDto.optional(),
  })
  .strict();

export type PreviewTemplateDto = z.infer<typeof PreviewTemplateDto>;
