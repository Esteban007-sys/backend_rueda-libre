import 'dotenv/config';
import app from './app.js';
import { checkDatabaseConnection } from './config/db.js';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, async () => {
  console.log(`[Server] API Rueda Libre escuchando en http://localhost:${PORT}`);
  try {
    const dbTime = await checkDatabaseConnection();
    console.log(`[DB] Conexión establecida con PostgreSQL (${dbTime})`);
  } catch (error) {
    console.warn(`[DB] No se pudo verificar la conexión inicial: ${error.message}`);
  }
});
