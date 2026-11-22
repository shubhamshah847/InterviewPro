const nodemailer = require("nodemailer");

async function sendOtpEmail(email, otp, purpose) {
  const subject = purpose === "verify" ? "Verify your InterviewPro account" : "Reset your InterviewPro password";
  const isVerification = purpose === "verify";
  const heading = isVerification ? "Verify your email" : "Reset your password";
  const action = isVerification ? "confirm your email address and finish setting up your account" : "choose a new password for your account";
  const text = `${heading}\n\nUse this one-time code to ${action}:\n\n${otp}\n\nThis code expires in 10 minutes. If you did not request this, you can safely ignore this email.`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f3f8;font-family:Arial,Helvetica,sans-serif;color:#242331">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${heading} - your secure one-time code is inside.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f3f8">
      <tr>
        <td align="center" style="padding:36px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
            <tr>
              <td style="padding:0 8px 18px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="38" height="38" align="center" valign="middle" style="width:38px;height:38px;border-radius:12px;background:#7358dd;color:#ffffff;font-size:20px;font-weight:bold">i</td>
                    <td style="padding-left:10px;color:#242331;font-size:20px;font-weight:bold;letter-spacing:-.5px">InterviewPro</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0;background:#ffffff;border:1px solid #e9e7f0;border-radius:18px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:34px 36px 12px">
                      <div style="display:inline-block;padding:6px 10px;border-radius:20px;background:#f2efff;color:#6b52cb;font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Account security</div>
                      <h1 style="margin:18px 0 10px;color:#242331;font-size:26px;line-height:1.25;letter-spacing:-.7px">${heading}</h1>
                      <p style="margin:0;color:#6f6d7a;font-size:15px;line-height:1.7">Use the secure code below to ${action}.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 36px 20px">
                      <div style="padding:20px 12px;border:1px solid #e8e3fb;border-radius:12px;background:#faf9ff;text-align:center">
                        <div style="margin-bottom:8px;color:#898695;font-size:10px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase">Your one-time code</div>
                        <div style="color:#6348cb;font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:bold;letter-spacing:9px;line-height:1.3">${otp}</div>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 36px 30px">
                      <p style="margin:0 0 12px;color:#6f6d7a;font-size:13px;line-height:1.7"><strong style="color:#373543">This code expires in 10 minutes.</strong> For your security, never share it with anyone.</p>
                      <p style="margin:0;color:#92909d;font-size:12px;line-height:1.7">If you did not request this email, you can safely ignore it. Your account remains secure.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 12px 0;color:#9694a1;font-size:11px;line-height:1.7">Practice with confidence.<br><strong style="color:#777582">The InterviewPro team</strong></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  if (process.env.RESENDEMAIL_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESENDEMAIL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "InterviewPro <no-reply@shubhamsah.com.np>",
        to: [email],
        subject,
        text,
        html,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Resend email delivery failed:", result.message || response.status);
      const error = new Error("We could not send the email. Check the email provider configuration and try again.");
      error.status = 502;
      throw error;
    }
    return {};
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: email,
      subject,
      text,
      html,
    });
    return {};
  }

  if (!process.env.RESENDEMAIL_API_KEY) {
    if (process.env.NODE_ENV === "production") throw new Error("Email delivery is not configured.");
    console.info(`[development OTP] ${email}: ${otp}`);
    return { devOtp: otp };
  }
}

module.exports = sendOtpEmail;
