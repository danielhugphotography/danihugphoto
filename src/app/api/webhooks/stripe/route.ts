import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Hilfsfunktion zum Senden via Resend API (ohne externe Dateien)
async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  try {
    const res = await fetch("https://resend.com", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Daniel Hug Photography <info@danielhugphotography.ch>",
        to,
        subject,
        html,
      }),
    });
    return res.ok;
  } catch (error) {
    console.error("Resend Error:", error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.customer_details?.email;
    const customerName = session.customer_details?.name ?? "Kunde";

    if (!email) {
      return NextResponse.json({ error: "No customer email" }, { status: 400 });
    }

    // Line Items mit Produktdetails aus Stripe laden
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      expand: ["data.price.product"],
    });

    const items = lineItems.data.map((item) => {
      return {
        name: item.description ?? "Unbekanntes Produkt",
        quantity: item.quantity ?? 1,
      };
    });

    const primaryLabel = items.map((i) => `${i.quantity}x ${i.name}`).join(", ");

    // Lieferadresse robust auslesen
    const sessionAny = session as unknown as {
      shipping_details?: { address?: Stripe.Address; name?: string } | null;
      collected_information?: {
        shipping_details?: { address?: Stripe.Address; name?: string } | null;
      };
    };
    const rawAddress =
      sessionAny.collected_information?.shipping_details?.address ??
      sessionAny.shipping_details?.address ??
      null;

    const addressHtml = rawAddress
      ? `<p style="margin:4px 0;">${sessionAny.shipping_details?.name ?? customerName}<br>
         ${rawAddress.line1 ?? ""}${rawAddress.line2 ? ", " + rawAddress.line2 : ""}<br>
         ${rawAddress.postal_code ?? ""} ${rawAddress.city ?? ""}<br>
         ${rawAddress.country ?? ""}</p>`
      : "<p>Keine Lieferadresse angegeben</p>";

    const formattedAmount = session.amount_total
      ? `CHF ${(session.amount_total / 100).toFixed(2)}`
      : "–";

    // --- 1. E-MAIL AN DEN KUNDEN (Edles Schwarz/Gold Design) ---
    const customerMailHtml = `
      <div style="background:#0b0b0b; color:#ffffff; padding:40px 20px; font-family:'Helvetica Neue', Arial, sans-serif; text-align:center; max-width:600px; margin:0 auto; border:1px solid #1a1a1a;">
        <h1 style="color:#e4c285; font-size:26px; font-weight:300; letter-spacing:1px; margin-bottom:20px;">Vielen Dank für deine Bestellung</h1>
        <p style="font-size:16px; color:#cccccc; line-height:1.6; margin-bottom:30px;">Hallo ${customerName},<br><br>Vielen Dank für deinen Einkauf bei Daniel Hug Photography. Dein ausgewählter Schweizer Naturmoment wird nun im Fachlabor in höchster Qualität für dich vorbereitet.</p>
        
        <div style="background:#141414; padding:20px; border-radius:4px; text-align:left; margin-bottom:30px; border:1px solid #222;">
          <h3 style="color:#e4c285; margin-top:0; font-size:16px; border-bottom:1px solid #222; padding-bottom:10px;">Bestellübersicht</h3>
          <p style="margin:10px 0; color:#ffffff;"><strong>Produkt:</strong> ${primaryLabel}</p>
          <p style="margin:10px 0; color:#ffffff;"><strong>Gesamtbetrag:</strong> ${formattedAmount}</p>
        </div>

        <div style="background:#141414; padding:20px; border-radius:4px; text-align:left; margin-bottom:30px; border:1px solid #222;">
          <h3 style="color:#e4c285; margin-top:0; font-size:16px; border-bottom:1px solid #222; padding-bottom:10px;">Lieferadresse</h3>
          <div style="color:#cccccc; line-height:1.5;">${addressHtml}</div>
        </div>

        <p style="font-size:14px; color:#888888; margin-top:40px;">Bei Fragen zu deiner Bestellung kannst du einfach auf diese Mail antworten.</p>
        <hr style="border:0; border-top:1px solid #222; margin:30px 0;">
        <p style="font-size:12px; color:#666666; letter-spacing:1px;">DANIEL HUG PHOTOGRAPHY</p>
      </div>
    `;

    await sendEmail({
      to: email,
      subject: "Deine Bestellung bei Daniel Hug Photography",
      html: customerMailHtml,
    });

    // --- 2. E-MAIL AN DICH (Benachrichtigung über neuen Verkauf) ---
    const adminMailHtml = `
      <div style="font-family:sans-serif; color:#333; max-width:600px; margin:0 auto; padding:20px; border:1px solid #eee;">
        <h2 style="color:#2c3e50;">🎉 Neuer Verkauf auf danielhugphotography.ch!</h2>
        <p>Ein Kunde hat soeben eine Bestellung aufgegeben:</p>
        <table style="width:100%; border-collapse:collapse; margin:20px 0;">
          <tr style="background:#f8f9fa;"><td style="padding:10px; font-weight:bold; border:1px solid #ddd;">Kunde:</td><td style="padding:10px; border:1px solid #ddd;">${customerName} (${email})</td></tr>
          <tr><td style="padding:10px; font-weight:bold; border:1px solid #ddd;">Produkt:</td><td style="padding:10px; border:1px solid #ddd;">${primaryLabel}</td></tr>
          <tr style="background:#f8f9fa;"><td style="padding:10px; font-weight:bold; border:1px solid #ddd;">Umsatz:</td><td style="padding:10px; border:1px solid #ddd;">${formattedAmount}</td></tr>
          <tr><td style="padding:10px; font-weight:bold; border:1px solid #ddd;">Stripe ID:</td><td style="padding:10px; border:1px solid #ddd; font-size:11px;">${session.id}</td></tr>
        </table>
        <h3 style="color:#2c3e50; margin-top:30px;">Lieferadresse für den Versand:</h3>
        <div style="background:#f1f2f6; padding:15px; border-radius:4px; border-left:4px solid #e4c285;">${addressHtml}</div>
      </div>
    `;

    await sendEmail({
      to: "info@danielhugphotography.ch", // Deine Adresse
      subject: `🎉 Neuer Verkauf: ${primaryLabel}`,
      html: adminMailHtml,
    });
  }

  return NextResponse.json({ received: true });
}
