// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";
import { initDB } from "./db.js";
import { cotizar } from "./cotizador.js";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

let db;
(async () => { db = await initDB(); })();

// Prompt base (tema de la tienda)
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
  // Mantener solo los últimos N mensajes en memoria
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

  // 2. Calcular Cotización (siempre)
  const cotizacionTexto = cotizar(mensaje);

  // 3. Preparar contexto (Memoria, Data.json y Modos)
  let memoria = sessions[session_id] ? sessions[session_id] : [];

  let infoTienda = {};
  try {
    if (fs.existsSync("./data.json")) {
      infoTienda = JSON.parse(fs.readFileSync("./data.json", "utf8"));
    }
  } catch (e) { console.error(e); }

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
    // 4. Llamada a OpenRouter (IA)
    const respuesta = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.1-8b-instruct",
        messages: messagesToSend
      })
    });

    // --- INICIO DE CORRECCIÓN PARA DETECTAR ERRORES DE LA API (EJ. 401) ---
    if (!respuesta.ok) {
      const errorText = await respuesta.text();
      console.error(`Error HTTP ${respuesta.status}: ${errorText}`);
      // Responder con el error para que el frontend lo muestre (opcional, pero útil)
      return res.status(respuesta.status).json({
        respuesta: `Error del proveedor IA: ${respuesta.status}. Verifique clave o modelo.`
      });
    }
    // --- FIN DE CORRECCIÓN ---

    const data = await respuesta.json();
    const textoIA = data?.choices?.[0]?.message?.content || "No se obtuvo respuesta de la IA.";

    // --- INICIO DE CORRECCIÓN ADICIONAL para depuración ---
    if (textoIA === "No se obtuvo respuesta de la IA.") {
      console.error("Respuesta vacía o malformada de la IA:", JSON.stringify(data));
    }
    // --- FIN DE CORRECCIÓN ADICIONAL ---

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

// Ruta /contact: Modificada para no fallar si el correo no está configurado
app.post("/contact", async (req, res) => {
  const { nombre, email, mensaje } = req.body;

  // **VERIFICACIÓN CLAVE**: Si no hay transporter (porque no se configuraron variables SMTP), devuelve un mensaje informativo.
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

const port = process.env.PORT || 10000; // Asegurarse de que el puerto sea el que Render expone (10000 es común)
app.listen(port, () => console.log("Servidor IA escuchando en puerto " + port));

// backend/db.js
import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function initDB() {
  const db = await open({
    filename: "./mi_tienda_tech.db",
    driver: sqlite3.Database
  });

  await db.exec(`
 CREATE TABLE IF NOT EXISTS solicitudes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 nombre TEXT,
 email TEXT,
 tipo TEXT,
 mensaje TEXT,
 cotizacion TEXT,
 respuesta_ia TEXT,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
 );
 `);

  await db.exec(`
 CREATE TABLE IF NOT EXISTS conversaciones (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 session_id TEXT,
 role TEXT,
 content TEXT,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
 );
`);

  return db;
}