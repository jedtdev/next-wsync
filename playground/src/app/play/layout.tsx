import { cookies } from "next/headers";
import { IdentityProvider } from "@/lib/identity";
import { Jwt } from "@/lib/jwt";
import { RealtimeProvider } from "@/lib/wsync/client";

export default async function Layout({ children }: LayoutProps<"/">) {
  const store = await cookies();
  const token = store.get(Jwt.cookie.name)?.value ?? null;
  const session = token ? await Jwt.verify(token) : null;

  return (
    <IdentityProvider initialSession={session}>
      <RealtimeProvider>{children}</RealtimeProvider>
    </IdentityProvider>
  );
}
