# /ia/tasks

Usa esta carpeta para preparar tareas backend antes de pedir implementación a una IA.

## Formato recomendado por tarea
Crea un archivo por tarea, por ejemplo: `2026-01-enrollment-fix.md`.

Incluye siempre:
1. **Objetivo**: qué se quiere lograr y por qué.
2. **Alcance**: módulos/archivos que sí se pueden tocar.
3. **Fuera de alcance**: qué no se debe modificar.
4. **Restricciones**: reglas de negocio y técnicas (transacciones, contratos API, etc.).
5. **Criterios de aceptación**: cómo validar que quedó bien.

## Uso práctico con Codex/LLMs
- Pega el contenido de la tarea como entrada principal del prompt.
- Adjunta referencias: `ia/docs/ai-context.md` y `ia/docs/architecture.md`.
- Pide cambios mínimos y lista explícita de archivos a modificar.
