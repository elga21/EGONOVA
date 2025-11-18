const BACKEND = "https://egonova.onrender.com"; // URL del Web Service de Render
// Para pruebas locales: "http://localhost:3000" 
const sessionId = "sess_" + Math.random().toString(36).slice(2,9);

async function setMode(mode) {
    await fetch(BACKEND + "/set-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, mode })
    });
}

document.getElementById("modoSelect").addEventListener("change", (e) => {
    setMode(e.target.value);
});

document.getElementById("sendBtn").addEventListener("click", enviar);
document.getElementById("inputMsg").addEventListener("keydown", (e) => {
    if (e.key === "Enter") enviar();
});

// Event Listener para el nuevo botón de contacto
document.getElementById("contactBtn").addEventListener("click", enviarContacto);


async function enviar() {
    const input = document.getElementById("inputMsg");
    const chat = document.getElementById("chat");
    const nombre = document.getElementById("nombre").value;
    const email = document.getElementById("email").value;

    const texto = input.value;
    if (!texto) return;

    chat.innerHTML += `<p class='user'><b>Tú:</b> ${texto}</p>`;
    input.value = "";
    chat.scrollTop = chat.scrollHeight;

    try {
        const res = await fetch(BACKEND + "/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                session_id: sessionId,
                mensaje: texto,
                nombre,
                email
            })
        });

        const data = await res.json();

        chat.innerHTML += `<p class='ia'><b>IA [${data.modo}]:</b> ${data.respuesta}</p>`;
        chat.innerHTML += `<p class='ia'><b>Cotización estimada:</b> ${data.cotizacion}</p>`;
        chat.scrollTop = chat.scrollHeight;
    } catch (e) {
        chat.innerHTML += `<p class='ia'><b>IA:</b> Error conectando al backend (Ruta /chat).</p>`;
    }
}


// Función para enviar solicitud de contacto
async function enviarContacto() {
    const chat = document.getElementById("chat");
    const nombre = document.getElementById("nombre").value;
    const email = document.getElementById("email").value;
    const mensaje = document.getElementById("inputMsg").value;

    if (!nombre || !email || !mensaje) {
        alert("Por favor, llena tu nombre, email y describe el proyecto antes de enviar la solicitud de contacto.");
        return;
    }
    
    chat.innerHTML += `<p class='user'><b>Tú:</b> Enviando solicitud de contacto...</p>`;
    document.getElementById("inputMsg").value = "";

    try {
        const res = await fetch(BACKEND + "/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, email, mensaje })
        });

        const data = await res.json();

        // El backend devuelve {ok: false, error: ...} si el correo no está configurado.
        if (data.ok) {
            chat.innerHTML += `<p class='ia'><b>IA:</b> ${nombre}, tu solicitud ha sido enviada exitosamente a nuestro equipo (${email}). ¡Pronto te contactaremos!</p>`;
        } else {
            // Muestra el mensaje de error del backend (que indica que el correo no está activo)
            chat.innerHTML += `<p class='ia'><b>IA:</b> ${data.error || "Error desconocido al enviar la solicitud."}</p>`;
        }

        chat.scrollTop = chat.scrollHeight;

    } catch (e) {
        chat.innerHTML += `<p class='ia'><b>IA:</b> Error conectando al backend (Ruta /contact).</p>`;
        chat.scrollTop = chat.scrollHeight;
    }
}