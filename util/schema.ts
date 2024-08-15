import { AggregateAjvError } from "@segment/ajv-human-errors";
import Ajv, { type Schema } from "ajv";

/**
 * Make a validator that checks an input against a JSON schema.
 *
 * @remarks
 * Due to TypeScript design limitation, the returned lambda function needs to have an explicit type
 * annotation, like this:
 * ```
 * const validateX: (input: unknown) => asserts input is X = makeSchemaValidator<X>(schemaX);
 * ```
 * https://github.com/microsoft/TypeScript/pull/33622#issuecomment-575301357
 */
export function makeSchemaValidator<T = unknown>(schema: Schema): (input: unknown) => asserts input is T {
  const validate = new Ajv({
    allErrors: true,
    verbose: true,
  }).compile<T>(schema);
  return (input) => {
    if (!validate(input)) {
      throw new AggregateAjvError(validate.errors!);
    }
    return true;
  };
}
