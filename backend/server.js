// backend/server.js
import express from "express";
import cors from "cors";
import fs from "fs";
import fetch from "node-fetch";
import { initDB } from "./db.js";
import { cotizar } from "./cotizador.js";
import { generateLocalResponse } from "./ia_local.js"; // <-- NUEVO: Para la IA Local
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json());

let db;
(async () => { db = await initDB(); })();

// Memoria corta (Ajustado a 5)
const MEMORY_LIMIT = 5; 
const sessions = {};

// nodemailer
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

    // 3. Obtener el modo
    const modo = (sessions[session_id] && sessions[session_id].mode) || "vendedor";

    // 4. GENERAR RESPUESTA LOCAL (REEMPLAZANDO LA LLAMADA A GROQ)
    let textoIA = "";
    try {
        // Llama a la lógica de IA local basada en la librería compromise
        textoIA = generateLocalResponse(mensaje, modo, cotizacionTexto);
    } catch (error) {
        console.error("Error IA Local:", error);
        textoIA = "Error interno del asistente (NLP).";
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