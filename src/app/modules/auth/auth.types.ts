// import type { Role } from '@prisma/client';

import type { Role } from "@/generated/prisma/enums";

export interface AuthUser {
  id: string;
  role: Role;
}

declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}