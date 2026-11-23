const nodemailer = require("nodemailer");

async function sendOtpEmail(email, otp, purpose) {
  const subject = purpose === "verify" ? "Verify your InterviewPro account" : "Reset your InterviewPro password";
  const isVerification = purpose === "verify";
  const heading = isVerification ? "Verify your email" : "Reset your password";
  const action = isVerification ? "confirm your email address and finish setting up your account" : "choose a new password for your account";
  const text = `${heading}\n\nSomeone requested a code for an InterviewPro account using this email address. Use the code below to ${action}:\n\n${otp}\n\nThis code expires in 10 minutes. For your security, do not share it with anyone.\n\nIf you did not request this code, you can ignore this email.`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif;color:#252432">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${heading}. Your code expires in 10 minutes.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
            <tr>
              <td style="padding:0 0 16px;color:#252432;font-size:18px;font-weight:bold">
                InterviewPro
              </td>
            </tr>
            <tr>
              <td style="padding:28px;background:#ffffff;border:1px solid #e5e5e9;border-radius:8px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:0 0 18px">
                      <h1 style="margin:0 0 12px;color:#252432;font-size:22px;line-height:1.35">${heading}</h1>
                      <p style="margin:0 0 10px;color:#55545f;font-size:14px;line-height:1.6">Someone requested a code for an InterviewPro account using this email address.</p>
                      <p style="margin:0;color:#55545f;font-size:14px;line-height:1.6">Enter the code below to ${action}:</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 18px">
                      <div style="padding:16px;border:1px solid #e5e5e9;border-radius:6px;background:#fafafd;text-align:center">
                        <div style="margin-bottom:6px;color:#666570;font-size:12px">Your one-time code</div>
                        <div style="color:#4936a8;font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:bold;letter-spacing:7px;line-height:1.4">${otp}</div>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0">
                      <p style="margin:0 0 10px;color:#55545f;font-size:13px;line-height:1.6"><strong style="color:#252432">This code expires in 10 minutes.</strong> Do not share it with anyone.</p>
                      <p style="margin:0;color:#666570;font-size:13px;line-height:1.6">If you did not request this code, you can ignore this email.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:16px 12px 0;color:#777681;font-size:12px;line-height:1.6">InterviewPro</td>
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
