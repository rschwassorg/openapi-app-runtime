import type { RuntimeUser } from './types.js';

declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: RuntimeUser;
    }
  }
}

export {};
