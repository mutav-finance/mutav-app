/**
 * Result Pattern
 *
 * Domain operations return Result<TData, TError> instead of throwing.
 * Always return plain object literals — never wrap in helper functions.
 *
 * Why: clear function contracts, no null returns, no try/catch in domain
 * code, discriminated union gives exhaustive type narrowing.
 *
 * Usage:
 *
 *   type CreateOrderSuccessResult = { orderId: OrderId; status: OrderStatus }
 *   type CreateOrderErrorResult = { code: 'INVALID_INPUT' | 'DUPLICATE_ORDER' }
 *
 *   function createOrder(
 *     args: CreateOrderArgs,
 *   ): Result<CreateOrderSuccessResult, CreateOrderErrorResult> {
 *     if (!args.items.length) {
 *       return { success: false, error: { code: 'INVALID_INPUT' }, message: 'Order has no items' }
 *     }
 *     return { success: true, data: { orderId, status: 'draft' }, message: 'Order created' }
 *   }
 */

export type ResultError<E = Error | Record<string, unknown> | unknown> = {
  success: false;
  error: E;
  message: string;
};

export type ResultSuccess<T = object> = {
  success: true;
  data: T;
  message: string;
};

export type Result<T = object, E = Error | Record<string, unknown> | unknown> =
  | ResultSuccess<T>
  | ResultError<E>;
