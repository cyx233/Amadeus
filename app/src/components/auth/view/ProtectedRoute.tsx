import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import Onboarding from '../../onboarding/view/Onboarding';
import AuthLoadingScreen from './AuthLoadingScreen';

type ProtectedRouteProps = {
  children: ReactNode;
};

// Amadeus always runs in platform mode: the nginx gateway authenticates every
// request (see gateway/), so the app never renders its own login. This just
// gates on onboarding once the user is resolved.
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isLoading, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (!hasCompletedOnboarding) {
    return <Onboarding onComplete={refreshOnboardingStatus} />;
  }

  return <>{children}</>;
}
