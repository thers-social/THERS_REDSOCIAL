import js from "@eslint/js";
import react from "eslint-plugin-react";
// Las reglas de hooks no eran opcionales en la práctica: el código ya traía
// `// eslint-disable-next-line react-hooks/exhaustive-deps` en Messages.jsx y
// Profile.jsx, y sin el plugin registrado eslint fallaba con "Definition for
// rule ... was not found" -- un disable de una regla inexistente es un error,
// no una excepción silenciosa. Se agrega el plugin que esos comentarios ya
// asumían (ADR-016 §READINESS: dejar el entorno sin huecos).
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  { ignores: ["dist/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    plugins: { react, "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      // `rules-of-hooks` como error: violarla produce bugs reales de estado,
      // no un detalle de estilo. `exhaustive-deps` como warning: en los
      // efectos de polling del chat (Messages.jsx, ADR-014) omitir una
      // dependencia es a veces deliberado, y convertirla en error obligaría a
      // sembrar más disables de los que resuelve.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["*.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
