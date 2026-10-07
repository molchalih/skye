/**
 * Replaces the method `name` of `proto` with `replacement`, which receives
 * the receiver, the arguments, and a function calling the original.
 */
export function patchMethod<T extends object>(
  proto: T,
  name: string,
  replacement: (self: T, args: unknown[], original: () => unknown) => unknown,
): void {
  const original: unknown = Object.getOwnPropertyDescriptor(proto, name)?.value;
  if (typeof original !== "function") throw new Error(`no ${name}`);
  Object.defineProperty(proto, name, {
    configurable: true,
    writable: true,
    value(this: T, ...args: unknown[]): unknown {
      return replacement(this, args, () => Reflect.apply(original, this, args));
    },
  });
}
