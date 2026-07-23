import { KeyRound, Lock } from 'lucide-react';

type SetPasswordStepProps = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  isSubmitting: boolean;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
};

export default function SetPasswordStep({
  currentPassword,
  newPassword,
  confirmPassword,
  isSubmitting,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
}: SetPasswordStepProps) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-inset ring-primary/20">
          <KeyRound className="h-7 w-7 text-primary" />
        </div>
        <h2 className="font-serif text-xl font-bold tracking-tight text-foreground">Set Your Password</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Your account was created with a temporary password. Choose a new one to secure it.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="currentPassword" className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            <Lock className="h-4 w-4" />
            Current Password <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            id="currentPassword"
            value={currentPassword}
            onChange={(event) => onCurrentPasswordChange(event.target.value)}
            className="w-full rounded-xl border border-border bg-background/60 px-4 py-2.5 text-foreground shadow-sm transition-colors placeholder:text-muted-foreground/60 hover:border-foreground/20 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="The password you just logged in with"
            autoComplete="current-password"
            required
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label htmlFor="newPassword" className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            <KeyRound className="h-4 w-4" />
            New Password <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            id="newPassword"
            value={newPassword}
            onChange={(event) => onNewPasswordChange(event.target.value)}
            className="w-full rounded-xl border border-border bg-background/60 px-4 py-2.5 text-foreground shadow-sm transition-colors placeholder:text-muted-foreground/60 hover:border-foreground/20 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="At least 6 characters"
            autoComplete="new-password"
            required
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            <KeyRound className="h-4 w-4" />
            Confirm New Password <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            id="confirmPassword"
            value={confirmPassword}
            onChange={(event) => onConfirmPasswordChange(event.target.value)}
            className="w-full rounded-xl border border-border bg-background/60 px-4 py-2.5 text-foreground shadow-sm transition-colors placeholder:text-muted-foreground/60 hover:border-foreground/20 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Re-enter the new password"
            autoComplete="new-password"
            required
            disabled={isSubmitting}
          />
          {confirmPassword.length > 0 && confirmPassword !== newPassword && (
            <p className="mt-1 text-xs text-red-500">Passwords do not match.</p>
          )}
        </div>
      </div>
    </div>
  );
}
