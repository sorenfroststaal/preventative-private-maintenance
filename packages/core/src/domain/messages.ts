/**
 * Danish texts for validation and database errors (review D2): Zod's own English messages and raw
 * SQLite errors never reach the user.
 */
import { z, ZodIssueCode, type ZodErrorMap } from "zod";

const list = (v: readonly unknown[]) => v.map((x) => String(x)).join(", ");

export const danishErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") return { message: "Feltet skal udfyldes" };
      if (issue.expected === "number" || issue.expected === "integer") return { message: "Skal være et tal" };
      if (issue.expected === "string") return { message: "Skal være tekst" };
      return { message: "Forkert type af værdi" };
    case ZodIssueCode.invalid_enum_value:
      return { message: "Ugyldig værdi. Vælg en af mulighederne på listen" };
    case ZodIssueCode.invalid_literal:
    case ZodIssueCode.invalid_union:
    case ZodIssueCode.invalid_union_discriminator:
      return { message: "Ugyldig værdi" };
    case ZodIssueCode.unrecognized_keys:
      return { message: `Ukendt felt: ${list(issue.keys)}` };
    case ZodIssueCode.too_small:
      if (issue.type === "string") return { message: Number(issue.minimum) <= 1 ? "Feltet skal udfyldes" : `Skal være mindst ${issue.minimum} tegn` };
      if (issue.type === "array") return { message: `Vælg mindst ${issue.minimum}` };
      return { message: issue.inclusive ? `Skal være mindst ${issue.minimum}` : `Skal være større end ${issue.minimum}` };
    case ZodIssueCode.too_big:
      if (issue.type === "string") return { message: `Højst ${issue.maximum} tegn` };
      if (issue.type === "array") return { message: `Højst ${issue.maximum}` };
      return { message: issue.inclusive ? `Højst ${issue.maximum}` : `Skal være mindre end ${issue.maximum}` };
    case ZodIssueCode.invalid_string:
      if (issue.validation === "uuid") return { message: "Ugyldigt id" };
      if (issue.validation === "email") return { message: "Ugyldig e-mailadresse" };
      if (issue.validation === "url") return { message: "Ugyldig webadresse" };
      if (issue.validation === "datetime") return { message: "Ugyldigt tidspunkt" };
      if (issue.validation === "date") return { message: "Ugyldig dato (forventet ÅÅÅÅ-MM-DD)" };
      return { message: "Ugyldig tekst" };
    case ZodIssueCode.invalid_date:
      return { message: "Ugyldig dato" };
    case ZodIssueCode.not_multiple_of:
      return { message: `Skal gå op i ${issue.multipleOf}` };
    case ZodIssueCode.not_finite:
      return { message: "Skal være et endeligt tal" };
    case ZodIssueCode.custom:
      return { message: issue.message ?? "Ugyldig værdi" };
    default:
      return { message: ctx.defaultError === "Required" ? "Feltet skal udfyldes" : "Ugyldig værdi" };
  }
};

/** Parses with Danish messages (schema-specific messages still win). */
export const safeParseDanish = <S extends z.ZodTypeAny>(schema: S, input: unknown) => schema.safeParse(input, { errorMap: danishErrorMap });

/** A Danish text for SQLite constraint errors; other messages are returned unchanged. */
export function friendlyDbError(message: string): string {
  if (/UNIQUE constraint failed/i.test(message)) return "Findes allerede: samme værdi er brugt på en anden post.";
  if (/FOREIGN KEY constraint failed/i.test(message)) return "Posten hænger sammen med en anden post, der ikke findes eller stadig bruges.";
  if (/CHECK constraint failed/i.test(message)) return "Værdien er ikke tilladt her.";
  if (/NOT NULL constraint failed/i.test(message)) return "Et påkrævet felt mangler.";
  if (/database is locked|SQLITE_BUSY/i.test(message)) return "Arkivet er optaget lige nu. Prøv igen om et øjeblik.";
  return message;
}
