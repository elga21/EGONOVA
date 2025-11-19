// backend/server.js
import express from "express";
import cors from "cors";

import fs from "fs";
import fetch from "node-fetch";
import { initDB } from "./db.js";
import { cotizar } from "./cotizador.js";
import nodemailer from "nodemailer";



const app = express();
app.use(cors());
app.use(express.json());

let db;
(async () => { db = await initDB(); })();

// Prompt base (tema de la tienda) - ¡Se mantiene en español!
const sistema = {
    role: "system",
    content: `
Eres el asistente oficial de MiTiendaTech, especialista en servicios de desarrollo de software y electrónica.
Reglas:
- RESPONDER SOLO sobre los servicios de MiTiendaTech.
- Clasificar solicitudes y usar un formato claro.
- Si la consulta está fuera de tema, responder: "Solo puedo responder preguntas relacionadas con los servicios de MiTiendaTech."
- Siempre en español.
`
};

// Memoria corta (Ajustado a 5 según el documento)
const MEMORY_LIMIT = 5; 
const sessions = {};

// nodemailer (se mantiene la lógica de correo)
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

async function pushMessage(session_id, role, content) {
    if (!sessions[session_id]) sessions[session_id] = [];
    sessions[session_id].push({ role, content });
    while (sessions[session_id].length > MEMORY_LIMIT) {
        sessions[session_id].shift();
    }

    try {
        await db.run(
            `INSERT INTO conversaciones (session_id, role, content) VALUES (?, ?, ?)`,
            session_id, role, content
        );
    } catch (e) { console.error("DB error:", e); }
}

app.post("/set-mode", (req, res) => {
    const { session_id, mode } = req.body;
    if (!session_id) return res.status(400).json({ error: "session_id requerido" });
    sessions[session_id] = sessions[session_id] || [];
    sessions[session_id].mode = mode || "vendedor";
    res.json({ ok: true, mode: sessions[session_id].mode });
});

app.post("/chat", async (req, res) => {
    const { session_id = "anon", mensaje, nombre, email } = req.body;
    if (!mensaje) return res.status(400).json({ error: "mensaje requerido" });

    // 1. Guardar mensaje de usuario
    await pushMessage(session_id, "user", mensaje);

    // 2. Calcular Cotización
    const cotizacionTexto = cotizar(mensaje);

    // 3. Preparar contexto (Memoria, Data.json y Modos)
    let memoria = sessions[session_id] ? sessions[session_id] : [];
    
    let infoTienda = {};
    try {
        if (fs.existsSync("./data.json")) {
            infoTienda = JSON.parse(fs.readFileSync("./data.json","utf8"));
        }
    } catch(e){ console.error(e); }

    const modo = (sessions[session_id] && sessions[session_id].mode) || "vendedor";

    const promptMode = {
        role: "system",
        content: `Modo actual: ${modo}. Actúa según ese rol (vendedor/técnico/soporte/cotizador). Clasifica la solicitud y ofrece preguntas para clarificar si hace falta.`
    };

    const systemInfo = {
        role: "system",
        content: "Información interna: " + JSON.stringify(infoTienda)
    };

    const messagesToSend = [
        sistema,
        promptMode,
        systemInfo,
        ...memoria,
        { role: "user", content: mensaje }
    ];

    try {
        // 4. Llamada a GROQ (IA) - CORRECCIÓN DE MODELO
        const respuesta = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                // USA LA NUEVA VARIABLE DE ENTORNO
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                // CORRECCIÓN: USAR MODELO MIXTRAL DISPONIBLE EN GROQ
                model: "mllama3-8b-8192", 
                messages: messagesToSend,
                max_tokens: 512 // Límite de tokens para estabilidad
            })
        });

        // Manejo de errores de API
        if (!respuesta.ok) {
            const errorText = await respuesta.text();
            console.error(`Error HTTP ${respuesta.status}: ${errorText}`);
            // El mensaje de error indica que es Groq ahora
            return res.status(respuesta.status).json({ 
                respuesta: `Error del proveedor IA Groq: ${respuesta.status}. Verifique clave GROQ_API_KEY o modelo.` 
            });
        }
        
        const data = await respuesta.json();
        // Mensaje de depuración para identificar errores de Groq
        const textoIA = data?.choices?.[0]?.message?.content || "No se obtuvo respuesta de la IA (Groq).";

        if (textoIA === "No se obtuvo respuesta de la IA (Groq).") {
            console.error("Respuesta vacía o malformada de la IA:", JSON.stringify(data));
        }

        // 5. Guardar respuesta de IA
        await pushMessage(session_id, "assistant", textoIA);

        // 6. Registrar Solicitud en DB
        await db.run(
            `INSERT INTO solicitudes (nombre, email, tipo, mensaje, cotizacion, respuesta_ia) VALUES (?, ?, ?, ?, ?, ?)`,
            nombre || null,
            email || null,
            modo,
            mensaje,
            cotizacionTexto,
            textoIA
        );

        // 7. Respuesta al Frontend
        res.json({
            respuesta: textoIA,
            cotizacion: cotizacionTexto,
            modo
        });

    } catch (error) {
        console.error("Error IA (Catch):", error);
        res.status(500).json({ respuesta: "Error conectando a la IA." });
    }
});

// Ruta /contact: Se mantiene sin cambios
app.post("/contact", async (req, res) => {
    const { nombre, email, mensaje } = req.body;
    if (!transporter) {
        return res.json({ 
            ok: false, 
            error: "El servicio de contacto no está activo en este momento. Por favor, usa el chat para obtener cotizaciones o detalles." 
        });
    }

    if (!nombre || !email || !mensaje) {
        return res.status(400).json({ error: "Datos de contacto incompletos." });
    }

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: process.env.EMAIL_TO,
            subject: `Nueva solicitud de Contacto de: ${nombre}`,
            text: `
Nombre: ${nombre}
Email: ${email}
Mensaje: ${mensaje}
`
        });
        res.json({ ok: true, message: "Mensaje de contacto enviado exitosamente." });
    } catch (e) {
        console.error("Error enviando email de contacto:", e);
        res.status(500).json({ error: "Error enviando correo de contacto." });
    }
});

app.get("/solicitudes", async (req, res) => {
    try {
        const filas = await db.all(`SELECT * FROM solicitudes ORDER BY created_at DESC LIMIT 200`);
        res.json(filas);
    } catch (e) {
        res.status(500).json({ error: "Error DB" });
    }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Servidor IA escuchando en puerto " + port));