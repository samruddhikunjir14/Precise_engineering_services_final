// Supabase Edge Function: send-enquiry
// Required Supabase secrets:
// RESEND_API_KEY, ENQUIRY_TO_EMAIL, ENQUIRY_FROM_EMAIL
// ENQUIRY_FROM_EMAIL must use a domain verified in Resend.
const allowedOrigins = new Set([
  "https://preciseengineeringser.com",
  "https://www.preciseengineeringser.com",
  "https://samruddhikunjir14.github.io",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://preciseengineeringser.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed." }, 405);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("ENQUIRY_TO_EMAIL");
  const from = Deno.env.get("ENQUIRY_FROM_EMAIL");
  if (!apiKey || !to || !from) {
    return reply(req, { error: "The enquiry service is being configured. Please try again later or contact us by WhatsApp." }, 503);
  }

  let data: Record<string, unknown>;
  try { data = await req.json(); }
  catch { return reply(req, { error: "Invalid form submission." }, 400); }

  // Quietly accept bot submissions caught by the hidden honeypot.
  if (typeof data.website === "string" && data.website.trim()) return reply(req, { success: true });

  const name = typeof data.name === "string" ? data.name.trim() : "";
  const company = typeof data.company === "string" ? data.company.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const service = typeof data.service === "string" ? data.service.trim() : "";
  const message = typeof data.message === "string" ? data.message.trim() : "";

  if (name.length < 2 || name.length > 100) return reply(req, { error: "Please enter your name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return reply(req, { error: "Please enter a valid email address." }, 400);
  if (company.length > 120 || service.length > 120 || message.length < 5 || message.length > 5000) {
    return reply(req, { error: "Please check your company, service and project requirements." }, 400);
  }

  const textBody = [
    "New website enquiry — Precise Engineering Services",
    "",
    "Name: " + name,
    "Company: " + (company || "Not provided"),
    "Email: " + email,
    "Service: " + service,
    "",
    "Project requirements:",
    message,
  ].join("\n");

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: "Website enquiry: " + service + " — " + name,
      text: textBody,
    }),
  });

  if (!sent.ok) {
    const detail = await sent.text();
    console.error("Resend send failed:", sent.status, detail);
    return reply(req, { error: "We couldn't send your enquiry right now. Please try again later or contact us by WhatsApp." }, 502);
  }
  return reply(req, { success: true, message: "Your enquiry has been sent." }, 200);
});
