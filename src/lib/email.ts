/**
 * Email delivery abstraction.
 *
 * In production, this would integrate with an SMTP server, SendGrid, AWS SES,
 * or a similar service. For now, it logs the email content so the flow can be
 * tested without a real mail server.
 */

export interface ResetEmailParams {
  to: string;
  username: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface MfaEmailParams {
  to: string;
  username: string;
  code: string;
  expiresInMinutes: number;
}

export interface AccountLockedEmailParams {
  to: string;
  username: string;
  unlockUrl?: string;
}

export interface PasswordChangedEmailParams {
  to: string;
  username: string;
  changedAt: string;
}

function logEmail(subject: string, to: string, html: string): void {
  console.log(`[email] ${subject} to: ${to}`);
  console.log(`[email] HTML length: ${html.length}`);
}

export async function sendPasswordResetEmail(params: ResetEmailParams): Promise<void> {
  const { to, username, resetUrl, expiresInMinutes } = params;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .button { display: inline-block; padding: 12px 24px; background: #0066cc; color: white;
           text-decoration: none; border-radius: 4px; font-weight: bold; }
  .footer { margin-top: 30px; font-size: 12px; color: #666; }
</style></head>
<body>
  <div class="container">
    <h2>Password Reset Request</h2>
    <p>Hello ${username},</p>
    <p>We received a request to reset your password for the LGU Portal. Click the button below to choose a new password:</p>
    <p><a href="${resetUrl}" class="button">Reset Password</a></p>
    <p>This link expires in ${expiresInMinutes} minutes. If you did not request this change, you can safely ignore this email.</p>
    <div class="footer">
      <p>LGU Portal — Single Sign-On Gateway</p>
      <p>If you did not request this, no further action is required.</p>
    </div>
  </div>
</body>
</html>`;

  logEmail('Password reset email', to, html);
}

export async function sendMfaCodeEmail(params: MfaEmailParams): Promise<void> {
  const { to, username, code, expiresInMinutes } = params;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .code { font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center;
          padding: 20px; background: #f0f0f0; border-radius: 4px; margin: 20px 0; }
  .footer { margin-top: 30px; font-size: 12px; color: #666; }
</style></head>
<body>
  <div class="container">
    <h2>Your verification code</h2>
    <p>Hello ${username},</p>
    <p>Use the following code to complete your sign-in to the LGU Portal:</p>
    <div class="code">${code}</div>
    <p>This code expires in ${expiresInMinutes} minutes. If you did not request this code, you can safely ignore this email.</p>
    <div class="footer">
      <p>LGU Portal — Single Sign-On Gateway</p>
      <p>If you did not request this, no further action is required.</p>
    </div>
  </div>
</body>
</html>`;

  logEmail('MFA code email', to, html);
}

export async function sendAccountLockedEmail(params: AccountLockedEmailParams): Promise<void> {
  const { to, username, unlockUrl } = params;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .button { display: inline-block; padding: 12px 24px; background: #cc6600; color: white;
           text-decoration: none; border-radius: 4px; font-weight: bold; }
  .footer { margin-top: 30px; font-size: 12px; color: #666; }
</style></head>
<body>
  <div class="container">
    <h2>Account locked</h2>
    <p>Hello ${username},</p>
    <p>Your account has been temporarily locked due to multiple failed sign-in attempts. For security reasons, the lock will expire after 15 minutes.</p>
    ${unlockUrl ? `<p><a href="${unlockUrl}" class="button">Unlock Account</a></p>` : ''}
    <p>If you did not attempt to sign in, please contact the ICT Service Desk immediately.</p>
    <div class="footer">
      <p>LGU Portal — Single Sign-On Gateway</p>
    </div>
  </div>
</body>
</html>`;

  logEmail('Account locked email', to, html);
}

export async function sendPasswordChangedEmail(params: PasswordChangedEmailParams): Promise<void> {
  const { to, username, changedAt } = params;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .footer { margin-top: 30px; font-size: 12px; color: #666; }
</style></head>
<body>
  <div class="container">
    <h2>Password changed</h2>
    <p>Hello ${username},</p>
    <p>Your password was successfully changed on ${changedAt}.</p>
    <p>If you did not make this change, please contact the ICT Service Desk immediately.</p>
    <div class="footer">
      <p>LGU Portal — Single Sign-On Gateway</p>
    </div>
  </div>
</body>
</html>`;

  logEmail('Password changed email', to, html);
}

