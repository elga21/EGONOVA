// backend/cotizador.js
export function cotizar(proyecto) {
    const texto = (proyecto || "").toLowerCase();

    if (texto.includes("web")) return "Una web básica: 150-300 USD. Web avanzada: 300-800 USD.";
    if (texto.includes("móvil") || texto.includes("android") || texto.includes("ios"))
        return "App móvil simple: 300-600 USD. Compleja: 600-1500 USD.";
    if (texto.includes("c++") || texto.includes("python"))
        return "Software de escritorio/backend: 200-800 USD (según alcance).";
    if (texto.includes("microcontrolador") || texto.includes("arduino") || texto.includes("esp32"))
        return "Proyecto con microcontrolador: 80-400 USD.";
    if (texto.includes("sensor"))
        return "Sistema de sensores: 50-250 USD.";
    if (texto.includes("iot"))
        return "Proyecto IoT: 150-600 USD.";

    return "Necesito más detalles para estimar. Describe funcionalidades y alcance.";
}