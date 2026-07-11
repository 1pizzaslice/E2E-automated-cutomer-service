import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignIn,
  useAuth,
  useClerk,
} from "@clerk/clerk-react";
import type { CredentialsGateProps } from "./credentials.js";

interface ClerkCredentialsGateProps extends CredentialsGateProps {
  readonly publishableKey: string;
}

/**
 * The production credential gate: Clerk login sharing the Milestone 16
 * application (its session token already carries the `aud`/`email` the API
 * requires, ADR-0024). Signed out shows Clerk's `<SignIn>`; signed in, a fresh
 * rotating token is injected per request via `getToken`.
 */
export function ClerkCredentialsGate({
  publishableKey,
  children,
}: ClerkCredentialsGateProps) {
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <SignedOut>
        <div className="signin">
          <h1>Reviewer Console</h1>
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <ClerkCredentials>{children}</ClerkCredentials>
      </SignedIn>
    </ClerkProvider>
  );
}

function ClerkCredentials({ children }: CredentialsGateProps) {
  const { getToken } = useAuth();
  const { signOut } = useClerk();

  return (
    <>
      {children({
        getToken: () => getToken(),
        signOut: () => {
          void signOut();
        },
      })}
    </>
  );
}
