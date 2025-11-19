// backend/ia_local.js
import nlp from "compromise";
import fs from "fs";

// Cargar la información interna de la tienda
let infoTienda = {};
try {
    infoTienda = JSON.parse(fs.readFileSync("./data.json", "utf8"));
} catch (e) {
    console.error("Error al cargar data.json:", e);
}

function classifyIntent(mensaje) {
    const doc = nlp(mensaje.toLowerCase());
    
    // 1. Intentos de contacto / ayuda
    if (doc.has('hola|buenas|ayuda|necesito')) return 'saludo';
    
    // 2. Intenciones específicas de servicios (usando la información de data.json)
    if (doc.has('precio|cotizar|cuanto vale')) return 'cotizacion';
    if (doc.has('software|aplicacion|web|móvil|python|javascript')) return 'servicio_software';
    if (doc.has('electrónica|arduino|sensor|iot|microcontrolador')) return 'servicio_electronica';
    
    // 3. Intenciones de contacto
    if (doc.has('contacto|email|teléfono')) return 'contacto_info';

    return 'general';
}

function generateResponse(intent, mensaje, modo, cotizacionTexto) {
    const tiendaNombre = infoTienda.nombre || "MiTiendaTech";
    const serviciosSoftware = infoTienda.servicios.software.join(", ");
    const serviciosElectronica = infoTienda.servicios.electronica.join(", ");

    // Respuesta basada en el modo (simplificado)
    let respuestaModo = `¡Hola! Soy tu asistente en ${tiendaNombre}.`;
    if (modo === 'cotizador') {
        respuestaModo = "Soy el cotizador. En base a tu solicitud, aquí tienes la estimación.";
    } else if (modo === 'técnico') {
        respuestaModo = "Soy el asistente técnico. ¿En qué proyecto podemos ayudarte?";
    }

    // Lógica de Respuesta
    switch (intent) {
        case 'saludo':
            return `${respuestaModo} ¿En qué te puedo ayudar hoy?`;
        
        case 'cotizacion':
            return `${respuestaModo} ${cotizacionTexto} ¿Quieres más detalles sobre alguno de nuestros servicios?`;
            
        case 'servicio_software':
            return `Nos especializamos en Software, incluyendo: ${serviciosSoftware}. ¿Podrías detallar el proyecto?`;
            
        case 'servicio_electronica':
            return `Nuestros servicios de Electrónica incluyen: ${serviciosElectronica}. ¿Qué tipo de prototipo o sistema necesitas?`;
            
        case 'contacto_info':
             const contacto = infoTienda.contacto || {};
             return `Puedes contactarnos por email: ${contacto.email} o teléfono: ${contacto.telefono}.`;
             
        case 'general':
        default:
             // Comprobar si está fuera de tema (simple)
             if (mensaje.length > 50 && !mensaje.includes('tienda')) {
                 return "Solo puedo responder preguntas relacionadas con los servicios de MiTiendaTech.";
             }
             return "No estoy seguro de la intención. ¿Buscas un servicio de software, electrónica o una cotización?";
    }
}

export function generateLocalResponse(mensaje, modo, cotizacionTexto) {
    const intent = classifyIntent(mensaje);
    const respuesta = generateResponse(intent, mensaje, modo, cotizacionTexto);
    return respuesta;
}