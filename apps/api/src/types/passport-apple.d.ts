declare module 'passport-apple' {
  import { Strategy as PassportStrategy } from 'passport';

  export interface AppleStrategyOptions {
    clientID: string;
    teamID: string;
    keyID: string;
    privateKeyString: string;
    callbackURL: string;
    passReqToCallback?: boolean;
    scope?: string[];
  }

  export type VerifyCallback = (err: Error | null, user?: unknown) => void;

  export default class Strategy extends PassportStrategy {
    constructor(options: AppleStrategyOptions, verify: (...args: unknown[]) => void);
    name: string;
  }
}
