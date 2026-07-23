import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../../utils/api';

const MIN_PASSWORD_LENGTH = 6;

export default function AccountSettingsTab() {
  const { t } = useTranslation('settings');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    newPassword === confirmPassword &&
    !isSubmitting;

  const handleSubmit = async () => {
    setMessage(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setMessage({ type: 'error', text: t('account.errors.tooShort', { count: MIN_PASSWORD_LENGTH }) });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: t('account.errors.mismatch') });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.user.changePassword(currentPassword, newPassword);
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || t('account.errors.failed'));
      }
      setMessage({ type: 'success', text: t('account.success') });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : t('account.errors.failed') });
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

  return (
    <section className="max-w-md space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">{t('account.password.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('account.password.description')}</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor="acc-current" className="mb-1 block text-sm font-medium text-foreground">
            {t('account.password.current')}
          </label>
          <input
            id="acc-current"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className={inputClass}
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label htmlFor="acc-new" className="mb-1 block text-sm font-medium text-foreground">
            {t('account.password.new')}
          </label>
          <input
            id="acc-new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className={inputClass}
            placeholder={t('account.password.newPlaceholder', { count: MIN_PASSWORD_LENGTH })}
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label htmlFor="acc-confirm" className="mb-1 block text-sm font-medium text-foreground">
            {t('account.password.confirm')}
          </label>
          <input
            id="acc-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={inputClass}
            disabled={isSubmitting}
          />
          {confirmPassword.length > 0 && confirmPassword !== newPassword && (
            <p className="mt-1 text-xs text-red-500">{t('account.errors.mismatch')}</p>
          )}
        </div>
      </div>

      {message && (
        <p className={message.type === 'success' ? 'text-sm text-emerald-600 dark:text-emerald-400' : 'text-sm text-red-500'}>
          {message.text}
        </p>
      )}

      <button
        onClick={() => { void handleSubmit(); }}
        disabled={!canSubmit}
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        {t('account.password.submit')}
      </button>
    </section>
  );
}
