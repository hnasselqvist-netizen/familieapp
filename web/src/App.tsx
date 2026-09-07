import { RouterProvider } from "react-router-dom";
import { LoginScreen } from "@features/auth/LoginScreen";
import { useAuthUser } from "@hooks/useAuthUser";
import { FamilyIdProvider } from "@hooks/useFamilyId";
import { router } from "./routes/router";

export function App() {
  const user = useAuthUser();

  if (user === undefined) {
    return <div role="status">Laster…</div>;
  }
  if (user === null) {
    return <LoginScreen />;
  }

  return (
    <FamilyIdProvider value="familie1">
      <RouterProvider router={router} />
    </FamilyIdProvider>
  );
}
