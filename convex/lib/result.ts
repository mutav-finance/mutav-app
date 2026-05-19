/**
 * Result Pattern (Convex-side mirror of src/lib/result.ts)
 *
 * Domain mutations/queries return Result<TData, TError> instead of throwing.
 * Always return plain object literals — never wrap in helper functions.
 *
 * Why a Convex-local copy: the `@` alias is not available inside `convex/`
 * files (Convex module resolver), and entity files can't reach across the
 * boundary to `src/lib/result.ts`. The shape mirrors the client type so a
 * mutation result narrows the same way on both sides of the wire.
 *
 * Usage:
 *
 *   type CreateContractSuccessResult = { contractId: ContractId; status: ContractStatus };
 *   type CreateContractErrorResult = { code: "INVALID_INPUT" | "DUPLICATE_CONTRACT" };
 *
 *   export const createContract = mutation({
 *     args: { ... },
 *     handler: async (
 *       ctx,
 *       args,
 *     ): Promise<Result<CreateContractSuccessResult, CreateContractErrorResult>> => {
 *       if (!args.tenant.cpf) {
 *         return {
 *           success: false,
 *           error: { code: "INVALID_INPUT" },
 *           message: "Tenant CPF is required",
 *         };
 *       }
 *       return {
 *         success: true,
 *         data: { contractId, status: "pendente" },
 *         message: "Contract created",
 *       };
 *     },
 *   });
 */

export type ResultError<E = Record<string, unknown>> = {
  success: false;
  error: E;
  message: string;
};

export type ResultSuccess<T = object> = {
  success: true;
  data: T;
  message: string;
};

export type Result<T = object, E = Record<string, unknown>> = ResultSuccess<T> | ResultError<E>;
