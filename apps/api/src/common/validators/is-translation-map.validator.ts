import { registerDecorator, ValidationOptions } from 'class-validator';

export function IsTranslationMap(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isTranslationMap',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be an object with at least a non-empty "fr-CA" entry`,
        ...options,
      },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          const map = value as Record<string, unknown>;
          if (Object.keys(map).length === 0) return false;
          const frCA = map['fr-CA'];
          return typeof frCA === 'string' && frCA.trim().length > 0;
        },
      },
    });
  };
}
