import { useEffect, useState } from "react";
import { subscribeAuthUser } from "@data/auth.repository";
import type { AuthUser } from "@app-types/auth";

/** undefined = ikke avgjort ennå, null = ikke innlogget, AuthUser = innlogget. */
export function useAuthUser(): AuthUser | null | undefined {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => subscribeAuthUser(setUser), []);

  return user;
}
