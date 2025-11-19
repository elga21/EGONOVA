// backend/ia_local.js
import nlp from "compromise";
import fs from "fs";

// Cargar la información interna de la tienda (Mantenemos la lógica de respaldo)
let infoTienda = {};
try {
    infoTienda = JSON.parse(fs.readFileSync("./data.json", "utf8")); 
} catch (e) {
    infoTienda = { 
        nombre: "MiTiendaTech", 
        contacto: { email: "contacto@mitiendatech.com", telefono: "N/A" },
        servicios: { software: ["Web"], electronica: ["IoT"] } 
    };
}

function classifyIntent(mensaje) {
    const doc = nlp(mensaje.toLowerCase());
    
    // 1. Intentos de contacto / ayuda
    if (doc.has('hola|buenas|ayuda|necesito|saludos|que tal|como estas|un favor')) return 'saludo';
    
    // 2. Intenciones de cotización
    if (doc.has('precio|cotizar|cuanto vale|estimar|valor|presupuesto')) return 'cotizacion';
    
    // 3. Intención de Software (Añadimos palabras más específicas de proyectos)
    if (doc.has('software|aplicacion|web|móvil|python|javascript|programacion|sistema|app|paginas|desarrollo')) return 'servicio_software';
    
    // 4. Intención de Electrónica (Añadimos más sinónimos)
    if (doc.has('electrónica|arduino|sensor|iot|microcontrolador|robot|prototipo|circuito|pcb|hardware')) return 'servicio_electronica';
    
    // 5. Intención General de Servicio (Captura "servicio" como raíz)
    if (doc.has('servicio|servicios|que ofrecen|venden|productos')) return 'servicio_general';

    // 6. Intenciones de contacto
    if (doc.has('contacto|email|teléfono|llamar|escribir|datos')) return 'contacto_info';

    return 'general';
}

function generateResponse(intent, mensaje, modo, cotizacionTexto) {
    const tiendaNombre = infoTienda.nombre || "MiTiendaTech";
    const serviciosSoftware = infoTienda.servicios.software.join(", ");
    const serviciosElectronica = infoTienda.servicios.electronica.join(", ");

    // Respuesta basada en el modo
    let respuestaModo = `¡Hola! Soy tu asistente en ${tiendaNombre}.`;
    if (modo === 'cotizador') {
        respuestaModo = "Soy el cotizador. En base a tu solicitud, aquí tienes la estimación.";
    } else if (modo === 'técnico') {
        respuestaModo = "Soy el asistente técnico. Dime, ¿cuál es tu proyecto?";
    }

    // Lógica de Respuesta
    switch (intent) {
        case 'saludo':
            return `${respuestaModo} ¿En qué te puedo ayudar hoy?`;
        
        case 'cotizacion':
            if (cotizacionTexto.includes('Necesito más detalles')) {
                return `${respuestaModo} Para cotizar, necesito que me describas el proyecto, funcionalidades y alcance.`;
            }
            return `${respuestaModo} ${cotizacionTexto} ¿Quieres más detalles sobre nuestros servicios?`;
            
        case 'servicio_software':
            return `Nos especializamos en Software, incluyendo: ${serviciosSoftware}. ¿Podrías detallar el proyecto?`;
            
        case 'servicio_electronica':
            return `Nuestros servicios de Electrónica incluyen: ${serviciosElectronica}. ¿Qué tipo de prototipo o sistema necesitas?`;
            
        case 'servicio_general': 
            return `${respuestaModo} ¡Claro! Ofrecemos dos grandes áreas de servicio: 1. Software (Desarrollo Web, Apps) y 2. Electrónica (Prototipado IoT). ¿Cuál te interesa más?`;
            
        case 'contacto_info':
             const contacto = infoTienda.contacto || {};
             return `Puedes contactarnos por email: ${contacto.email} o teléfono: ${contacto.telefono}.`;
             
        case 'general':
        default:
             // Respuesta para intención no clara
             return `${respuestaModo} No estoy seguro de lo que buscas. Por favor, especifica si es Software, Electrónica o si deseas una cotización.`;
    }
}

export function generateLocalResponse(mensaje, modo, cotizacionTexto) {
    const intent = classifyIntent(mensaje);
    const respuesta = generateResponse(intent, mensaje, modo, cotizacionTexto);
    return respuesta;
}