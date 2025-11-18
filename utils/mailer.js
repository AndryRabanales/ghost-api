// andryrabanales/ghost-api/utils/mailer.js
const { Resend } = require('resend');

// Asegúrate de instalar el paquete: npm install resend
// Y pon RESEND_API_KEY en tu .env
const resend = new Resend(process.env.RESEND_API_KEY); 

async function sendAccessLinkEmail(email, chatUrl, creatorName, contentPreview) {
  if (!email) return;

  try {
    const { data, error } = await resend.emails.send({
      from: 'Ghosty <noreply@tu-dominio.com>', // Necesitas un dominio verificado
      to: [email],
      subject: `Tu mensaje para ${creatorName} fue enviado 👻`,
      html: `
        <div style="font-family: sans-serif; color: #333;">
          <h2>¡Mensaje Enviado Exitosamente!</h2>
          <p>Has enviado un mensaje anónimo a <strong>${creatorName}</strong>.</p>
          <p><strong>Tu mensaje:</strong> "${contentPreview}..."</p>
          <hr />
          <h3>📌 No pierdas este chat</h3>
          <p>Para ver la respuesta cuando llegue, guarda este enlace o haz clic en el botón:</p>
          <a href="${chatUrl}" style="background-color: #8e2de2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Ver mi Chat
          </a>
          <p style="margin-top: 20px; font-size: 12px; color: #666;">
            Si el botón no funciona, copia este enlace: <br />
            ${chatUrl}
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