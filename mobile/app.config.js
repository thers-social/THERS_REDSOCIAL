// Configuración dinámica de Expo: parte de `app.json` (que sigue siendo la fuente) y solo añade lo que
// depende de archivos locales que NO viven en el repositorio.
//
// `google-services.json` (ADR-053): lo genera la consola de Firebase para el paquete `com.thers.app` y es
// necesario para que el teléfono obtenga su token de notificaciones push. Es una configuración del proyecto
// (no una clave secreta del servidor), pero cada equipo/entorno usa el suyo, así que está en `.gitignore`.
// Si el archivo no existe la app compila igual, solo que sin push.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const googleServices = path.join(__dirname, 'google-services.json');
  if (!fs.existsSync(googleServices)) return config;
  return {
    ...config,
    android: { ...config.android, googleServicesFile: './google-services.json' },
  };
};
