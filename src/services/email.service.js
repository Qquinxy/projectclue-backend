const nodemailer = require('nodemailer')
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASSWORD,
  MAIL_FROM,
  FRONTEND_URL,
  NODE_ENV,
} = require('../config/env')

// Real SMTP delivery. Credentials come only from environment variables —
// nothing about the mail account is ever committed to the repository.
//
// The transport is created lazily and reused, so a misconfigured mail server
// does not stop the API from booting; it fails at send time instead, where
// the caller can surface a useful message.
let transporter = null

const isConfigured = () => Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD)

const getTransporter = () => {
  if (!isConfigured()) {
    throw new Error(
      'Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and MAIL_FROM in the backend .env file.'
    )
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      // Port 465 is implicit TLS; 587 upgrades via STARTTLS.
      secure: SMTP_SECURE !== undefined ? SMTP_SECURE : Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    })
  }

  return transporter
}

exports.isEmailConfigured = isConfigured

exports.verifyConnection = async () => {
  const tx = getTransporter()
  await tx.verify()
  return true
}

// Builds the link the user clicks. It points at the frontend verification
// page, which then calls the backend verification endpoint.
const buildVerificationUrl = (token) =>
  `${FRONTEND_URL.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`

// Never includes the user's password — only the one-time verification link.
exports.sendVerificationEmail = async ({ to, firstName, token }) => {
  const url = buildVerificationUrl(token)
  const name = firstName || 'ผู้ใช้งาน'

  const text = [
    `สวัสดีคุณ ${name},`,
    '',
    'ขอบคุณที่สมัครสมาชิก ProjectClue — ระบบสารสนเทศชมรมและกิจกรรมมหาวิทยาลัย',
    'กรุณายืนยันอีเมลของคุณโดยเปิดลิงก์ด้านล่างนี้ (ลิงก์มีอายุ 24 ชั่วโมง):',
    '',
    url,
    '',
    'หากคุณไม่ได้สมัครสมาชิก กรุณาเพิกเฉยต่ออีเมลฉบับนี้',
    '',
    'ProjectClue',
  ].join('\n')

  const html = `
  <div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="margin:0 0 16px;font-size:20px;color:#1f2937">ยืนยันอีเมลของคุณ</h2>
    <p style="margin:0 0 12px">สวัสดีคุณ ${name},</p>
    <p style="margin:0 0 16px">
      ขอบคุณที่สมัครสมาชิก <strong>ProjectClue</strong> — ระบบสารสนเทศชมรมและกิจกรรมมหาวิทยาลัย<br />
      กรุณายืนยันอีเมลของคุณโดยคลิกปุ่มด้านล่าง (ลิงก์มีอายุ 24 ชั่วโมง)
    </p>
    <p style="margin:0 0 24px">
      <a href="${url}"
         style="display:inline-block;background:#6b3e00;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">
        ยืนยันอีเมล
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#6b7280">หากปุ่มไม่ทำงาน ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:</p>
    <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${url}">${url}</a></p>
    <p style="margin:0;font-size:13px;color:#6b7280">หากคุณไม่ได้สมัครสมาชิก กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
  </div>`

  const info = await getTransporter().sendMail({
    from: MAIL_FROM || SMTP_USER,
    to,
    subject: 'ยืนยันอีเมลของคุณ | ProjectClue Email Verification',
    text,
    html,
  })

  if (NODE_ENV !== 'production') {
    console.log(`[email] verification sent to ${to} (messageId: ${info.messageId})`)
  }

  return info
}

// Confirmation of a Super Admin-equivalent appointment. Uses the same
// transport and the same /verify-email link format as address verification —
// only the wording differs, so there is no second verification system.
exports.sendElevationEmail = async ({ to, firstName, token }) => {
  const url = buildVerificationUrl(token)
  const name = firstName || 'ผู้ดูแลชมรม'

  const text = [
    `สวัสดีคุณ ${name},`,
    '',
    'ผู้ดูแลระบบได้แต่งตั้งบัญชีของคุณให้มีสิทธิ์เทียบเท่าผู้ดูแลระบบ (Super Admin) ใน ProjectClue',
    'สิทธิ์นี้จะยังไม่มีผลจนกว่าคุณจะยืนยันการแต่งตั้งผ่านลิงก์ด้านล่างนี้ (ลิงก์มีอายุ 24 ชั่วโมง):',
    '',
    url,
    '',
    'หากคุณไม่ได้คาดหมายการแต่งตั้งนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ และแจ้งผู้ดูแลระบบ',
    '',
    'ProjectClue',
  ].join('\n')

  const html = `
  <div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="margin:0 0 16px;font-size:20px;color:#1f2937">ยืนยันการแต่งตั้งสิทธิ์ผู้ดูแลระบบ</h2>
    <p style="margin:0 0 12px">สวัสดีคุณ ${name},</p>
    <p style="margin:0 0 16px">
      ผู้ดูแลระบบได้แต่งตั้งบัญชีของคุณให้มีสิทธิ์เทียบเท่าผู้ดูแลระบบ (Super Admin) ใน
      <strong>ProjectClue</strong><br />
      สิทธิ์นี้จะ<strong>ยังไม่มีผล</strong>จนกว่าคุณจะยืนยันการแต่งตั้ง (ลิงก์มีอายุ 24 ชั่วโมง)
    </p>
    <p style="margin:0 0 24px">
      <a href="${url}"
         style="display:inline-block;background:#6b3e00;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">
        ยืนยันการแต่งตั้ง
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#6b7280">หากปุ่มไม่ทำงาน ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:</p>
    <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${url}">${url}</a></p>
    <p style="margin:0;font-size:13px;color:#6b7280">
      หากคุณไม่ได้คาดหมายการแต่งตั้งนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ และแจ้งผู้ดูแลระบบ
    </p>
  </div>`

  const info = await getTransporter().sendMail({
    from: MAIL_FROM || SMTP_USER,
    to,
    subject: 'ยืนยันการแต่งตั้งสิทธิ์ผู้ดูแลระบบ | ProjectClue Admin Appointment',
    text,
    html,
  })

  if (NODE_ENV !== 'production') {
    console.log(`[email] elevation sent to ${to} (messageId: ${info.messageId})`)
  }

  return info
}
