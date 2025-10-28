// netlify/functions/quote-request.js
// Sends the quote form to Eli via MailerSend.
// Requires Netlify ENV VARS: MAILERSEND_TOKEN, MAILERSEND_FROM, MAILERSEND_TO

// Small helper for responses
const json = (status, data) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json",
    // Allow your site to call this function from the browser
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  // ---- 0) Simple per-IP rate-limit (5 requests / 10 minutes)
  try {
    const RATE = 5;
    const WINDOW_MS = 10 * 60 * 1000;
    const now = Date.now();
    const ip =
      (event.headers["x-forwarded-for"] || event.headers["client-ip"] || "")
        .split(",")[0]
        .trim() || "unknown";

    const store = (globalThis.__hits ||= new Map());
    const bucket = (store.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    bucket.push(now);
    store.set(ip, bucket);

    if (bucket.length > RATE) {
      return json(429, { error: "Too many requests. Please try again later." });
    }
  } catch (e) {
    // If rate-limit storage fails for any reason, continue without blocking
    console.warn("Rate limit check failed:", e?.message || e);
  }

  // ---- 1) Read env vars (set these in Netlify UI -> Site settings -> Environment variables)
  const API_TOKEN = process.env.MAILERSEND_TOKEN; // e.g. mlsn_xxx...
  const FROM_EMAIL = process.env.MAILERSEND_FROM; // e.g. no-reply@test-xxxxx.mlsender.net
  const TO_EMAIL = process.env.MAILERSEND_TO; // e.g. eli_etremovals@proton.me

  if (!API_TOKEN || !FROM_EMAIL || !TO_EMAIL) {
    return json(500, { error: "Server not configured. Missing env vars." });
  }

  // ---- 2) Parse and validate incoming JSON
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }

  // Honeypot stops bots (your form includes name="company")
  if (payload.company) {
    return json(200, { ok: true, skipped: true }); // pretend success, but drop it
  }

  const {
    fullName = "",
    phone = "",
    email = "",
    address = payload.address || payload.postcode || "",
    service = "",
    date = "",
    message = "",
    attachments = [], // optional: [{ filename, content_type, base64 }]
  } = payload || {};

  const missing =
    !fullName.trim()
      ? "name"
      : !/^\S+@\S+\.\S+$/.test(email)
      ? "valid email"
      : !phone.trim()
      ? "phone"
      : !address.trim()
      ? "postcode"
      : !service
      ? "service"
      : !message.trim()
      ? "message"
      : null;

  if (missing) return json(400, { error: `Please provide a ${missing}.` });

  // ---- 3) Build email content
  const safe = (s) => String(s || "").toString();

  const subject = `New Quote Request — ${safe(fullName)} (${safe(service)})`;

  const textBody = `
New quote request

Full name: ${safe(fullName)}
Phone: ${safe(phone)}
Email: ${safe(email)}
Postcode: ${safe(address)}
Service: ${safe(service)}
Preferred date: ${safe(date)}

Message:
${safe(message)}
`.trim();

  const htmlBody = `
  <h2>New quote request</h2>
  <p><strong>Full name:</strong> ${safe(fullName)}</p>
  <p><strong>Phone:</strong> ${safe(phone)}</p>
  <p><strong>Email:</strong> ${safe(email)}</p>
  <p><strong>Postcode:</strong> ${safe(address)}</p>
  <p><strong>Service:</strong> ${safe(service)}</p>
  <p><strong>Preferred date:</strong> ${safe(date || "n/a")}</p>
  <p><strong>Message:</strong><br>${safe(message).replace(/\n/g, "<br>")}</p>
  `.trim();

  // ---- 4) Convert any attachments to MailerSend format (cap at 5)
  // MailerSend expects: { filename, content } where content = base64 string
  let msAttachments = [];
  if (Array.isArray(attachments) && attachments.length) {
    msAttachments = attachments.slice(0, 5).map((a, i) => ({
      filename: a.filename || `photo-${i + 1}.jpg`,
      content: a.base64 || "",
    }));
  }

  // ---- 5) Send to Eli via MailerSend API
  try {
    const resp = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: { email: FROM_EMAIL }, // your test domain sender
        to: [{ email: TO_EMAIL }], // Eli's inbox
        reply_to: { email }, // hitting Reply goes to the customer
        subject,
        text: textBody,
        html: htmlBody,
        attachments: msAttachments, // optional
      }),
    });

    // Try to read JSON even if not-ok, to surface message
    let data = {};
    try {
      data = await resp.json();
    } catch {}

    if (!resp.ok) {
      console.error("MailerSend error:", resp.status, data);
      return json(500, {
        error:
          data?.message ||
          "Email send failed. Please try again or call 07305 848484.",
      });
    }

    // ---- 6) Fire-and-forget confirmation email to customer (best-effort)
    (async () => {
      try {
        await fetch("https://api.mailersend.com/v1/email", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: { email: FROM_EMAIL, name: "ET Handyman Services" },
            to: [{ email }], // customer's email
            subject: "We’ve received your quote request ✅",
            text: `Hi ${fullName || ""},

Thanks for your request. Here’s what we got:
- Service: ${service || "Handyman service"}
- Postcode/Address: ${address || ""}
- Preferred date: ${date || "Not specified"}

We’ll contact you shortly. If urgent, call 07305 848484.

— ET Handyman Services`,
            html: `<p>Hi ${fullName || "there"},</p>
                   <p>Thanks for your request. We’ve logged the details below:</p>
                   <ul>
                     <li><b>Service:</b> ${service || "Handyman service"}</li>
                     <li><b>Postcode/Address:</b> ${address || ""}</li>
                     <li><b>Preferred date:</b> ${date || "Not specified"}</li>
                   </ul>
                   <p>We’ll get back to you shortly. For urgent jobs, call <a href="tel:+447305848484">07305 848484</a>.</p>
                   <p>— ET Handyman Services</p>`,
          }),
        });
      } catch (e) {
        console.warn("Confirmation email failed:", e?.message || e);
      }
    })();

    // Main success response (don't wait for confirmation)
    return json(200, { ok: true, id: data?.message_id || "sent" });
  } catch (err) {
    console.error(err);
    return json(500, {
      error: "Network error sending email. Please try again later.",
    });
  }
};
