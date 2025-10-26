// netlify/functions/quote-request.js
import fetch from "node-fetch";

export const handler = async (event) => {
  try {
    const data = JSON.parse(event.body || "{}");

    const {
      fullName,
      email,
      phone,
      address,
      service,
      date,
      message,
      attachments = [],
    } = data;

    // --- Build email content ---
    const text = `
New quote request from ET Handyman Services website

Name: ${fullName}
Email: ${email}
Phone: ${phone}
Address: ${address}
Service: ${service}
Preferred Date: ${date || "Not specified"}
Message:
${message}
    `;

    // MailerSend API setup
    const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY;
    const MAIL_FROM = process.env.MAIL_FROM || "eli_etremovals@proton.me";
    const MAIL_TO = process.env.MAIL_TO || "eli_etremovals@proton.me";

    // --- Send email to business (you) ---
    const sendBusinessEmail = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MAILERSEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: { email: MAIL_FROM, name: "ET Handyman Services Website" },
        to: [{ email: MAIL_TO, name: "ET Handyman Services" }],
        subject: `New Quote Request from ${fullName}`,
        text,
        attachments: attachments.map(f => ({
          content: f.base64,
          filename: f.filename,
          disposition: "attachment",
          type: f.content_type
        }))
      })
    });

    if (!sendBusinessEmail.ok) {
      const errText = await sendBusinessEmail.text();
      throw new Error(`MailerSend error: ${errText}`);
    }

    // --- Send confirmation to client ---
    await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MAILERSEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: { email: MAIL_FROM, name: "ET Handyman Services" },
        to: [{ email, name: fullName }],
        subject: "Quote Request Received — ET Handyman Services",
        text: `Hi ${fullName},

Thanks for reaching out! We’ve received your quote request for "${service}" and will get back to you shortly.

Kind regards,
ET Handyman Services
        `
      })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Server error" })
    };
  }
};
