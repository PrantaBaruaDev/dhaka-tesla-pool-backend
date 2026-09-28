import type { Role } from "@/../prisma/generated/prisma/enums";

export interface AuthUser {
  id: string;
  role: Role;
}

declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}