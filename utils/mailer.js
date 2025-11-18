// andryrabanales/ghost-api/utils/mailer.js
const { Resend } = require('resend');

// Asegúrate de haber instalado el paquete: npm install resend
// Y de tener RESEND_API_KEY configurada en tu .env de Railway
const resend = new Resend(process.env.RESEND_API_KEY); 

async function sendAccessLinkEmail(email, chatUrl, creatorName, contentPreview) {
  if (!email) return;

  try {
    const { data, error } = await resend.emails.send({
      // 👇 CAMBIO IMPORTANTE: Usamos el dominio de pruebas de Resend
      from: 'Ghosty <onboarding@resend.dev>', 
      to: [email], // En modo prueba, este email debe ser el mismo con el que te registraste en Resend
      subject: `Tu mensaje para ${creatorName} fue enviado 👻`,
      html: `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #8e2de2;">¡Mensaje Enviado Exitosamente!</h2>
          <p>Has enviado un mensaje anónimo a <strong>${creatorName}</strong>.</p>
          <p style="background-color: #f9f9f9; padding: 10px; border-left: 4px solid #8e2de2; font-style: italic;">
            "${contentPreview}..."
          </p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
          <h3>📌 No pierdas este chat</h3>
          <p>Para ver la respuesta cuando llegue, es indispensable que guardes este acceso:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${chatUrl}" style="background-color: #8e2de2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              Ver mi Chat
            </a>
          </div>
          <p style="margin-top: 20px; font-size: 12px; color: #666; text-align: center;">
            Si el botón no funciona, copia y pega este enlace en tu navegador: <br />
            <a href="${chatUrl}" style="color: #8e2de2;">${chatUrl}</a>
          </p>
        </div>
      `,
    });

    if (error) {
      console.error("❌ Error enviando email:", error);
    } else {
      console.log("✅ Email de acceso enviado a:", email);
    }
  } catch (err) {
    console.error("❌ Excepción enviando email:", err);
  }
}

module.exports = { sendAccessLinkEmail };